import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Logger } from '@nestjs/common';
import simpleGit, { SimpleGit } from 'simple-git';
import { safeResolveVaultPath } from 'src/shared/utils/path-validation';
import { IGitOpsBackend } from './git-ops.backend';
import { CreatePullRequestOptions, CreatePullRequestResult, WriteFileChange } from '../git-ops.types';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import { GitOpsRebaseConflictError } from '../errors';

const BRANCH_NAME_MAX_LENGTH = 200;
const FORBIDDEN_TRAILER_REGEX = /^Co-Authored-By:\s*(?:Claude|AI)/im;
const NON_FAST_FORWARD_REGEX = /non-fast-forward|! \[rejected\]|tip of your current branch is behind/i;

export class LocalGitOpsBackend implements IGitOpsBackend {
  readonly mode = 'local' as const;
  private readonly logger = new Logger(LocalGitOpsBackend.name);
  private gitInstance: SimpleGit | null = null;

  constructor(private readonly vaultPath: string) {}

  private get git(): SimpleGit {
    if (this.gitInstance === null) {
      this.gitInstance = simpleGit({ baseDir: this.vaultPath });
    }
    return this.gitInstance;
  }

  async pullLatestMain(): Promise<void> {
    try {
      await this.git.checkout('main');
      await this.git.pull('origin', 'main', { '--ff-only': null });
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? '';
      if (NON_FAST_FORWARD_REGEX.test(msg)) {
        throw new InternalException(ErrorCode.GIT_OPS_PULL_NON_FF, `pull --ff-only failed for main: local diverged from origin/main`);
      }
      // In local mode without a real remote, pull fails silently.
      this.logger.log({
        message: 'local backend: pullLatestMain skipped (no remote)',
        event: 'backend.local.pullLatestMain.skipped',
        reason: msg.slice(0, 120),
      });
    }
  }

  async createBranch(name: string): Promise<void> {
    this.assertBranchNameValid(name);
    await this.git.raw(['checkout', '-B', name]);
    this.logger.log({ message: 'local backend: branch created', event: 'backend.local.createBranch', name });
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
    this.logger.log({ message: 'local backend: files written', event: 'backend.local.writeFiles', count: changes.length });
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
      this.logger.log({ message: 'local backend: commit skipped — nothing to commit', event: 'backend.local.commit.skipped' });
      return;
    }

    await this.git.commit(message, paths);
    const sha = (await this.git.revparse(['HEAD'])).trim();
    this.logger.log({ message: 'local backend: commit completed', event: 'backend.local.commit', sha: sha.slice(0, 7) });
  }

  async push(branch: string): Promise<void> {
    try {
      await this.git.push('origin', branch, { '-u': null });
      this.logger.log({ message: 'local backend: push completed', event: 'backend.local.push', branch });
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? '';
      if (NON_FAST_FORWARD_REGEX.test(msg)) {
        await this.recoverFromStaleLocal(branch);
        await this.git.push('origin', branch, { '-u': null });
        this.logger.log({ message: 'local backend: push recovered after rebase', event: 'backend.local.push.recovered', branch });
        return;
      }
      // Only swallow push errors when the vault has no remote (e.g., local mode
      // without a real push URL — in tests, the remote is set to no_push). In
      // that case the commit already succeeded locally, which is sufficient.
      if (this.isNoRemoteError(err)) {
        this.logger.log({ message: 'local backend: push skipped (no remote)', event: 'backend.local.push.skipped', branch });
        return;
      }
      throw err;
    }
  }

  private isNoRemoteError(err: unknown): boolean {
    const msg = (err as { message?: string })?.message ?? '';
    return /not a git repository|could not read|couldn't find remote/i.test(msg);
  }

  private async recoverFromStaleLocal(branch: string): Promise<void> {
    this.logger.warn({ message: 'local backend: push non-FF — attempting rebase', event: 'backend.local.push.nonFastForward', branch });
    await this.git.fetch('origin', 'main');
    try {
      await this.git.rebase(['origin/main']);
    } catch (rebaseErr) {
      await this.git.rebase(['--abort']).catch(() => undefined);
      throw new GitOpsRebaseConflictError(branch, this.parseConflictedFiles(rebaseErr));
    }
    this.logger.log({ message: 'local backend: rebase succeeded', event: 'backend.local.push.rebaseSucceeded', branch });
  }

  private parseConflictedFiles(err: unknown): string[] {
    const message = (err as { message?: string })?.message ?? '';
    const gitOut = (err as { git?: string })?.git ?? '';
    const haystack = `${message}\n${gitOut}`;
    const files: string[] = [];
    const re = /CONFLICT \([^)]+\): Merge conflict in (\S+)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(haystack)) !== null) {
      files.push(match[1]!);
    }
    return files;
  }

  async createPullRequest(_opts: CreatePullRequestOptions): Promise<CreatePullRequestResult> {
    return { url: '' };
  }

  async mergeBranch(branch: string): Promise<void> {
    await this.git.checkout('main');
    try {
      await this.git.merge([branch, '--ff-only']);
    } catch (err) {
      throw new InternalException(ErrorCode.GIT_OPS_MERGE_FAILED, `merge branch '${branch}' into main failed: ${(err as Error).message}`);
    }
    this.logger.log({ message: 'local backend: merge completed', event: 'backend.local.mergeBranch', branch });
  }

  async fetchOriginMain(): Promise<void> {
    try {
      await this.git.fetch('origin', 'main');
    } catch {
      // Silently skip — local mode has no remote to fetch from.
      this.logger.log({ message: 'local backend: fetchOriginMain skipped (no remote)', event: 'backend.local.fetchOriginMain.skipped' });
    }
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
}
