import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Logger } from '@nestjs/common';
import simpleGit, { SimpleGit } from 'simple-git';
import { safeResolveVaultPath } from 'src/shared/utils/path-validation';
import { IGitOpsBackend } from './git-ops.backend';
import { CreatePullRequestOptions, CreatePullRequestResult, WriteFileChange } from '../git-ops.types';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import { GitOpsRebaseConflictError } from '../errors';

const execFileAsync = promisify(execFile);
const BRANCH_NAME_MAX_LENGTH = 200;
const FORBIDDEN_TRAILER_REGEX = /^Co-Authored-By:\s*(?:Claude|AI)/im;
const NON_FAST_FORWARD_REGEX = /non-fast-forward|! \[rejected\]|tip of your current branch is behind/i;
const REBASE_CONFLICT_FILE_REGEX = /CONFLICT \([^)]+\): Merge conflict in (\S+)/g;
const GH_EXISTING_PR_STDERR_REGEX = /a pull request for branch/i;

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

  async pullLatestMain(): Promise<void> {
    await this.git.checkout('main');
    try {
      await this.git.pull('origin', 'main', { '--ff-only': null });
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

  async push(branch: string): Promise<void> {
    try {
      await this.git.push('origin', branch, { '-u': null });
      this.logger.log({ message: 'github backend: push completed', event: 'backend.github.push', branch });
    } catch (err) {
      if (!this.isNonFastForward(err)) {
        this.logger.error({ message: 'github backend: push failed', event: 'backend.github.push.failed', branch });
        throw err;
      }
      await this.recoverFromStaleLocal(branch);
      await this.git.push('origin', branch, { '-u': null });
      this.logger.log({ message: 'github backend: push recovered after rebase', event: 'backend.github.push.recovered', branch });
    }
  }

  async createPullRequest(opts: CreatePullRequestOptions): Promise<CreatePullRequestResult> {
    const args = ['pr', 'create', '--head', opts.branch, '--base', 'main', '--title', opts.title, '--body', opts.body];
    if (opts.autoMerge) {
      args.push('--label', 'auto-merge');
    }

    const env = { ...process.env, GH_TOKEN: this.ghToken };
    try {
      const result = await execFileAsync('gh', args, { cwd: this.vaultPath, env });
      const url = result.stdout.trim();
      this.logger.log({
        message: 'github backend: PR created',
        event: 'backend.github.createPullRequest',
        branch: opts.branch,
        urlPath: this.safeUrlPath(url),
      });
      return { url };
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
      throw new InternalException(ErrorCode.GIT_OPS_PR_CREATION_FAILED, `gh pr create failed: ${stderr.slice(0, 200)}`);
    }
  }

  async mergeBranch(_branch: string): Promise<void> {
    // No-op in github mode
  }

  async fetchOriginMain(): Promise<void> {
    await this.git.fetch('origin', 'main');
  }

  private async recoverFromStaleLocal(branch: string): Promise<void> {
    this.logger.warn({ message: 'github backend: push non-FF — attempting rebase', event: 'backend.github.push.nonFastForward', branch });
    await this.git.fetch('origin', 'main');
    try {
      await this.git.rebase(['origin/main']);
    } catch (rebaseErr) {
      await this.git.rebase(['--abort']).catch(() => undefined);
      throw new GitOpsRebaseConflictError(branch, this.parseConflictedFiles(rebaseErr));
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
