import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Logger } from '@nestjs/common';
import simpleGit, { SimpleGit } from 'simple-git';
import { safeResolveVaultPath } from 'src/shared/utils/path-validation';
import { IGitOpsBackend } from './git-ops.backend';
import { applyConflictResolverOrThrow } from './apply-conflict-resolver';
import { ConflictResolver, CreatePullRequestOptions, CreatePullRequestResult, WriteFileChange } from '../git-ops.types';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';

const execFileAsync = promisify(execFile);
const BRANCH_NAME_MAX_LENGTH = 200;
const FORBIDDEN_TRAILER_REGEX = /^Co-Authored-By:\s*(?:Claude|AI)/im;
const NON_FAST_FORWARD_REGEX = /non-fast-forward|! \[rejected\]|tip of your current branch is behind/i;
const REBASE_CONFLICT_FILE_REGEX = /CONFLICT \([^)]+\): Merge conflict in (\S+)/g;
const GH_EXISTING_PR_STDERR_REGEX = /a pull request for branch/i;
// The auto-merge label is decorative; actual merging is done via `gh pr merge`.
// Repos may not have the label provisioned, so we detect and recover gracefully.
const GH_LABEL_NOT_FOUND_STDERR_REGEX = /could not add label/i;

export class GitHubGitOpsBackend implements IGitOpsBackend {
  readonly mode = 'github' as const;
  private readonly logger = new Logger(GitHubGitOpsBackend.name);
  private gitInstance: SimpleGit | null = null;

  constructor(
    private readonly vaultPath: string,
    private readonly ghToken: string,
  ) {}

  private get git(): SimpleGit {
    if (this.gitInstance === null) {
      this.gitInstance = simpleGit({ baseDir: this.vaultPath });
    }
    return this.gitInstance;
  }

  async resetToCleanMain(): Promise<void> {
    // Discard any dirty/junk working-tree state left by a prior interrupted dream
    // and re-sync local main to the authenticated origin tip, so every dream
    // starts from a clean, up-to-date base (idempotent under Temporal retry).
    // The server never hand-edits this clone, so uncommitted changes are crash
    // leftovers and safe to discard.
    await this.git.fetch(await this.authenticatedRemoteUrl(), 'main');
    await this.git.raw(['checkout', '-B', 'main', 'FETCH_HEAD']);
    await this.git.raw(['reset', '--hard', 'FETCH_HEAD']);
    await this.git.raw(['clean', '-fd']);
    await this.pruneMergedDreamBranches();
    this.logger.log({ message: 'github backend: reset to clean main', event: 'backend.github.resetToCleanMain' });
  }

  private async pruneMergedDreamBranches(): Promise<void> {
    // Delete local dream/* branches that are fully merged into the new main, so
    // they don't accumulate unbounded. Never delete main. Best-effort.
    try {
      const raw = await this.git.raw(['branch', '--list', 'dream/*']);
      const branches = raw
        .split('\n')
        .map((b) => b.replace('*', '').trim())
        .filter((b) => b.length > 0);
      for (const b of branches) {
        try {
          await this.git.raw(['branch', '-D', b]);
        } catch {
          // best-effort — individual branch deletion failures must not fail the dream
        }
      }
    } catch {
      // best-effort — pruning failure must not fail the dream
    }
  }

  async pullLatestMain(): Promise<void> {
    await this.git.checkout('main');
    try {
      await this.git.pull(await this.authenticatedRemoteUrl(), 'main', { '--ff-only': null });
    } catch (err) {
      if (this.isNonFastForward(err)) {
        throw new InternalException(ErrorCode.GIT_OPS_PULL_NON_FF, `pull --ff-only failed for main: local diverged from origin/main`);
      }
      throw err;
    }
    this.logger.log({ message: 'github backend: pull latest main completed', event: 'backend.github.pullLatestMain' });
  }

  async createBranch(name: string): Promise<void> {
    this.assertBranchNameValid(name);
    await this.git.raw(['checkout', '-B', name]);
    this.logger.log({ message: 'github backend: branch created', event: 'backend.github.createBranch', name });
  }

  async writeFiles(changes: WriteFileChange[]): Promise<void> {
    for (const change of changes) {
      const resolved = safeResolveVaultPath(this.vaultPath, change.path);
      if (resolved === null) {
        throw new InternalException(ErrorCode.GIT_OPS_VAULT_PATH_INVALID, `vault path '${change.path}' resolves outside the vault root`);
      }
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      const tmp = `${resolved}.tmp`;
      await fs.writeFile(tmp, change.content, 'utf-8');
      await fs.rename(tmp, resolved);
    }
    this.logger.log({ message: 'github backend: files written', event: 'backend.github.writeFiles', count: changes.length });
  }

  async commit(message: string, paths: string[]): Promise<void> {
    if (FORBIDDEN_TRAILER_REGEX.test(message)) {
      throw new InternalException(
        ErrorCode.GIT_OPS_FORBIDDEN_TRAILER,
        `commit message contains forbidden AI co-author trailer (preview: ${message.slice(0, 80)})`,
      );
    }

    await this.git.add(paths);
    const status = await this.git.status();
    if (status.staged.length === 0) {
      this.logger.log({ message: 'github backend: commit skipped — nothing to commit', event: 'backend.github.commit.skipped' });
      return;
    }

    await this.git.commit(message, paths);
    const sha = (await this.git.revparse(['HEAD'])).trim();
    this.logger.log({ message: 'github backend: commit completed', event: 'backend.github.commit', sha: sha.slice(0, 7) });
  }

  async push(branch: string, resolver?: ConflictResolver): Promise<void> {
    const remote = await this.authenticatedRemoteUrl();
    try {
      await this.git.push(remote, branch, { '-u': null });
      this.logger.log({ message: 'github backend: push completed', event: 'backend.github.push', branch });
    } catch (err) {
      if (!this.isNonFastForward(err)) {
        this.logger.error({ message: 'github backend: push failed', event: 'backend.github.push.failed', branch });
        throw err;
      }
      await this.recoverFromStaleLocal(branch, resolver);
      // After rebasing onto main, the dream branch legitimately diverges from any
      // stale remote dream branch left by a prior failed attempt. Force-with-lease
      // overwrites that disposable, server-owned branch. NEVER force a non-dream
      // branch (main is only ever fast-forwarded — hard boundary).
      await this.pushBranch(remote, branch);
      this.logger.log({ message: 'github backend: push recovered after rebase', event: 'backend.github.push.recovered', branch });
    }
  }

  private async pushBranch(remote: string, branch: string): Promise<void> {
    if (this.isDreamBranch(branch)) {
      await this.git.push(remote, branch, { '-u': null, '--force-with-lease': null });
    } else {
      await this.git.push(remote, branch, { '-u': null });
    }
  }

  private isDreamBranch(branch: string): boolean {
    return branch.startsWith('dream/');
  }

  /**
   * Build a push/fetch URL authenticated with the in-process `GH_TOKEN`, derived
   * from the `origin` remote's host/path. This makes `GH_TOKEN` the single source
   * of truth for remote auth so the vault's `origin` remote never needs its
   * embedded credential rotated when the token is refreshed.
   */
  private async authenticatedRemoteUrl(): Promise<string> {
    const rawUrl = (await this.git.remote(['get-url', 'origin']))?.toString().trim() ?? '';
    // Strip any existing `user:token@` or `x-access-token:token@` credential.
    const hostAndPath = rawUrl.replace(/^https:\/\/[^@/]*@/, 'https://').replace(/^https:\/\//, '');
    return `https://x-access-token:${this.ghToken}@${hostAndPath}`;
  }

  async createPullRequest(opts: CreatePullRequestOptions): Promise<CreatePullRequestResult> {
    const baseArgs = ['pr', 'create', '--head', opts.branch, '--base', 'main', '--title', opts.title, '--body', opts.body];
    const env = { ...process.env, GH_TOKEN: this.ghToken };

    try {
      const args = opts.autoMerge ? [...baseArgs, '--label', 'auto-merge'] : baseArgs;
      return await this.runPrCreate(args, opts, env);
    } catch (err) {
      const errno = err as NodeJS.ErrnoException & { stderr?: string; code?: string };
      if (errno.code === 'ENOENT') {
        throw new InternalException(ErrorCode.GIT_OPS_GH_CLI_MISSING, 'gh CLI not found on PATH');
      }
      const stderr = typeof errno.stderr === 'string' ? errno.stderr : '';
      if (GH_EXISTING_PR_STDERR_REGEX.test(stderr)) {
        const url = await this.fetchExistingPrUrl(opts.branch);
        this.logger.log({
          message: 'github backend: PR already exists — reusing URL',
          event: 'backend.github.createPullRequest.idempotent',
          branch: opts.branch,
        });
        return { url };
      }
      // The auto-merge label is decorative (merging is done via gh pr merge); if the
      // repo lacks the label, retry once without it rather than failing the dream.
      if (opts.autoMerge && GH_LABEL_NOT_FOUND_STDERR_REGEX.test(stderr)) {
        this.logger.warn({
          message: 'github backend: auto-merge label missing — retrying PR create without label',
          event: 'backend.github.createPullRequest.labelMissing',
          branch: opts.branch,
        });
        try {
          return await this.runPrCreate(baseArgs, opts, env);
        } catch (retryErr) {
          const retryStderr = typeof (retryErr as { stderr?: string }).stderr === 'string' ? (retryErr as { stderr: string }).stderr : '';
          throw new InternalException(ErrorCode.GIT_OPS_PR_CREATION_FAILED, `gh pr create failed: ${retryStderr.slice(0, 200)}`);
        }
      }
      throw new InternalException(ErrorCode.GIT_OPS_PR_CREATION_FAILED, `gh pr create failed: ${stderr.slice(0, 200)}`);
    }
  }

  private async runPrCreate(args: string[], opts: CreatePullRequestOptions, env: NodeJS.ProcessEnv): Promise<CreatePullRequestResult> {
    const result = await execFileAsync('gh', args, { cwd: this.vaultPath, env });
    const url = result.stdout.trim();
    this.logger.log({
      message: 'github backend: PR created',
      event: 'backend.github.createPullRequest',
      branch: opts.branch,
      urlPath: this.safeUrlPath(url),
    });
    if (opts.autoMerge) {
      await this.mergePullRequest(opts.branch, url, env);
    }
    return { url };
  }

  /**
   * Merge a dream PR immediately (merge commit + delete branch). Auto-merge is
   * "land it, the user reviews the vault history later". On any failure
   * (genuine conflict, failing check, transient error) the PR is LEFT OPEN and
   * the failure is logged — never thrown — so the dream still succeeds and the
   * user can merge manually. LLM-assisted conflict resolution is a deliberate
   * future follow-up (see design/git-ops.md §5.2), not done here.
   */
  private async mergePullRequest(branch: string, url: string, env: NodeJS.ProcessEnv): Promise<void> {
    try {
      await execFileAsync('gh', ['pr', 'merge', branch, '--merge', '--delete-branch'], { cwd: this.vaultPath, env });
      this.logger.log({
        message: 'github backend: PR auto-merged',
        event: 'backend.github.autoMerge.completed',
        branch,
        urlPath: this.safeUrlPath(url),
      });
    } catch (err) {
      const stderr = typeof (err as { stderr?: string }).stderr === 'string' ? (err as { stderr: string }).stderr : '';
      this.logger.warn({
        message: 'github backend: PR auto-merge failed — leaving PR open for manual review',
        event: 'backend.github.autoMerge.failed',
        branch,
        urlPath: this.safeUrlPath(url),
        reason: stderr.slice(0, 200),
      });
    }
  }

  async mergeBranch(_branch: string): Promise<void> {
    // No-op in github mode
  }

  async fetchOriginMain(): Promise<void> {
    await this.git.fetch(await this.authenticatedRemoteUrl(), 'main');
  }

  private async recoverFromStaleLocal(branch: string, resolver?: ConflictResolver): Promise<void> {
    this.logger.warn({ message: 'github backend: push non-FF — attempting rebase', event: 'backend.github.push.nonFastForward', branch });
    await this.git.fetch(await this.authenticatedRemoteUrl(), 'main');
    try {
      // Fetch-by-URL updates FETCH_HEAD (not the named-remote ref origin/main).
      await this.git.rebase(['FETCH_HEAD']);
    } catch (rebaseErr) {
      const conflictedFiles = this.parseConflictedFiles(rebaseErr);
      await applyConflictResolverOrThrow(this.git, branch, conflictedFiles, resolver);
      this.logger.log({ message: 'github backend: rebase conflict resolved by resolver', event: 'backend.github.push.conflictResolved', branch });
      return;
    }
    this.logger.log({ message: 'github backend: rebase succeeded', event: 'backend.github.push.rebaseSucceeded', branch });
  }

  private isNonFastForward(err: unknown): boolean {
    const message = (err as { message?: string })?.message ?? '';
    const gitOut = (err as { git?: string })?.git ?? '';
    return NON_FAST_FORWARD_REGEX.test(`${message} ${gitOut}`);
  }

  private parseConflictedFiles(err: unknown): string[] {
    const message = (err as { message?: string })?.message ?? '';
    const gitOut = (err as { git?: string })?.git ?? '';
    const haystack = `${message}\n${gitOut}`;
    const files: string[] = [];
    let match: RegExpExecArray | null;
    REBASE_CONFLICT_FILE_REGEX.lastIndex = 0;
    while ((match = REBASE_CONFLICT_FILE_REGEX.exec(haystack)) !== null) {
      files.push(match[1]!);
    }
    return files;
  }

  private async fetchExistingPrUrl(branch: string): Promise<string> {
    const env = { ...process.env, GH_TOKEN: this.ghToken };
    const { stdout } = await execFileAsync('gh', ['pr', 'list', '--head', branch, '--json', 'url', '--jq', '.[0].url'], { cwd: this.vaultPath, env });
    return stdout.trim();
  }

  private assertBranchNameValid(name: string): void {
    const reasons: string[] = [];
    if (name.length === 0) reasons.push('empty');
    if (name.length > BRANCH_NAME_MAX_LENGTH) reasons.push('too long');
    if (name.includes('..')) reasons.push('contains ..');
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(name)) reasons.push('contains control chars');
    if (name.startsWith('-')) reasons.push('starts with -');
    if (name !== name.trim()) reasons.push('leading/trailing whitespace');
    if (reasons.length > 0) {
      throw new InternalException(ErrorCode.GIT_OPS_BRANCH_NAME_INVALID, `invalid branch name (${reasons.join('; ')})`);
    }
  }

  private safeUrlPath(url: string): string {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  }
}
