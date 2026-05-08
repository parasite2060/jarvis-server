/**
 * GitOpsService — shared infrastructure wrapper for in-process git ops
 * + `gh` CLI subprocess (Story 13.7).
 *
 * Six idempotent primitives per `design/git-ops.md §2`:
 *   - `pullLatestMain` (§3.1)
 *   - `createBranch` (§3.2)
 *   - `writeFiles` (§3.3)
 *   - `commit` (§3.4)
 *   - `push` (§3.5) — with non-FF self-heal via fetch + rebase + retry-once
 *   - `createPullRequest` (§3.6)
 *
 * Mirrors Python `app/services/git_ops.py` (the SIX low-level primitives at
 * lines ~141–207); higher-level orchestration (`create_*_pr`, `cleanup_*`) is
 * NOT mirrored — those compose into dream commit-and-pr activities owned by
 * Stories 13.10/13.11/13.12.
 *
 * Architecture:
 *   - `simple-git` for in-process git ops (typed, async, cross-platform).
 *   - `child_process.execFile` ONLY for `gh` CLI subprocess (strict argv array;
 *     never shell concatenation).
 *   - All paths must resolve INSIDE `appConfig.vaultPath` — defensive
 *     reuse of `safeResolveVaultPath` from `src/shared/utils/`.
 *   - Forbidden: `Co-Authored-By: Claude/AI` trailer in commit messages
 *     (architecture §6.5 frozen rule).
 *
 * Error handling: `GitOpsService` is shared INFRASTRUCTURE, not a use case.
 * try/catch is permitted at boundary points the design explicitly requires
 * (push self-heal §3.5; existing-PR idempotency §3.6) per
 * `docs/standards/backend/error-handling.md`.
 */
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { Injectable, Logger } from '@nestjs/common';
import simpleGit, { SimpleGit } from 'simple-git';
import { AppConfigService } from 'src/shared/config/config.service';
import { safeResolveVaultPath } from 'src/shared/utils/path-validation';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import { GitOpsRebaseConflictError } from './errors';
import { CreatePullRequestOptions, CreatePullRequestResult, WriteFileChange } from './git-ops.types';

const execFileAsync = promisify(execFile);

const FORBIDDEN_TRAILER_REGEX = /^Co-Authored-By:\s*(?:Claude|AI)/im;
const NON_FAST_FORWARD_REGEX = /non-fast-forward|! \[rejected\]|tip of your current branch is behind/i;
const REBASE_CONFLICT_FILE_REGEX = /CONFLICT \([^)]+\): Merge conflict in (\S+)/g;
const GH_EXISTING_PR_STDERR_REGEX = /a pull request for branch/i;

const BRANCH_NAME_MAX_LENGTH = 200;

@Injectable()
export class GitOpsService {
  private readonly logger = new Logger(GitOpsService.name);
  private gitInstance: SimpleGit | null = null;

  constructor(private readonly appConfig: AppConfigService) {}

  /**
   * Lazy `simple-git` factory — `vaultPath` is config-frozen at boot
   * (env `VAULT_PATH`) so memoize once per service instance.
   */
  private get git(): SimpleGit {
    if (this.gitInstance === null) {
      this.gitInstance = simpleGit({ baseDir: this.appConfig.vaultPath });
    }
    return this.gitInstance;
  }

  // ---------------------------------------------------------------------------
  // §3.1 — pullLatestMain
  // ---------------------------------------------------------------------------
  async pullLatestMain(): Promise<void> {
    await this.git.checkout('main');
    // Boundary try/catch: design/git-ops.md §3.1 mandates --ff-only and a
    // typed error on divergence so activity-level retry can decide. Network
    // errors fall through to bubble (Temporal retry with backoff).
    try {
      await this.git.pull('origin', 'main', { '--ff-only': null });
    } catch (err) {
      if (this.isNonFastForward(err)) {
        throw new InternalException(ErrorCode.GIT_OPS_PULL_NON_FF, `pull --ff-only failed for main: local diverged from origin/main`);
      }
      throw err;
    }
    this.logger.log({
      message: 'git ops pull latest main completed',
      event: 'gitOps.pullLatestMain.completed',
      baseDir: this.appConfig.vaultPath,
    });
  }

  // ---------------------------------------------------------------------------
  // §3.2 — createBranch
  // ---------------------------------------------------------------------------
  async createBranch(name: string): Promise<void> {
    this.assertBranchNameValid(name);
    await this.git.raw(['checkout', '-B', name]);
    this.logger.log({
      message: 'git ops create branch completed',
      event: 'gitOps.createBranch.completed',
      name,
    });
  }

  // ---------------------------------------------------------------------------
  // §3.3 — writeFiles
  // ---------------------------------------------------------------------------
  async writeFiles(changes: WriteFileChange[]): Promise<void> {
    for (const change of changes) {
      const resolved = safeResolveVaultPath(this.appConfig.vaultPath, change.path);
      if (resolved === null) {
        throw new InternalException(ErrorCode.GIT_OPS_VAULT_PATH_INVALID, `vault path '${change.path}' resolves outside the vault root`);
      }
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      const tmp = `${resolved}.tmp`;
      await fs.writeFile(tmp, change.content, 'utf-8');
      await fs.rename(tmp, resolved);
    }
    this.logger.log({
      message: 'git ops write files completed',
      event: 'gitOps.writeFiles.completed',
      count: changes.length,
    });
  }

  // ---------------------------------------------------------------------------
  // §3.4 — commit
  // ---------------------------------------------------------------------------
  async commit(message: string, paths: string[]): Promise<void> {
    if (FORBIDDEN_TRAILER_REGEX.test(message)) {
      throw new InternalException(
        ErrorCode.GIT_OPS_FORBIDDEN_TRAILER,
        `commit message contains forbidden AI co-author trailer (preview: ${this.previewMessage(message)})`,
      );
    }

    await this.git.add(paths);

    // Q7 = (a): status-first detection. The post-`add` working tree must
    // contain at least one staged change for the commit to do work — otherwise
    // we treat the call as a no-op (Temporal retry idempotency, design §4).
    const status = await this.git.status();
    if (status.staged.length === 0) {
      this.logger.log({
        message: 'git ops commit skipped — nothing to commit',
        event: 'gitOps.commit.skipped',
        reason: 'noChanges',
      });
      return;
    }

    await this.git.commit(message, paths);
    const sha = (await this.git.revparse(['HEAD'])).trim();
    this.logger.log({
      message: 'git ops commit completed',
      event: 'gitOps.commit.completed',
      paths: paths.length,
      sha: sha.slice(0, 7),
    });
  }

  // ---------------------------------------------------------------------------
  // §3.5 — push (with non-FF self-heal)
  // ---------------------------------------------------------------------------
  async push(branch: string): Promise<void> {
    // Boundary try/catch: design/git-ops.md §3.5 mandates fetch+rebase+retry
    // self-heal on non-FF errors. This is THE CORE INVARIANT of the service.
    try {
      await this.git.push('origin', branch, { '-u': null });
      this.logger.log({
        message: 'git ops push completed',
        event: 'gitOps.push.completed',
        branch,
      });
      return;
    } catch (err) {
      if (!this.isNonFastForward(err)) {
        this.logger.error({
          message: 'git ops push failed',
          event: 'gitOps.push.failed',
          branch,
          errorClass: (err as { name?: string })?.name ?? 'UnknownError',
        });
        throw err;
      }
      await this.recoverFromStaleLocal(branch);
      // Retried push exactly ONCE — never loop. If retried push also fails
      // non-FF, the underlying error bubbles (activity decides retry).
      await this.git.push('origin', branch, { '-u': null });
      this.logger.log({
        message: 'git ops push recovered after rebase',
        event: 'gitOps.push.recovered',
        branch,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // §3.6 — createPullRequest
  // ---------------------------------------------------------------------------
  async createPullRequest(opts: CreatePullRequestOptions): Promise<CreatePullRequestResult> {
    const args = ['pr', 'create', '--head', opts.branch, '--base', 'main', '--title', opts.title, '--body', opts.body];
    if (opts.autoMerge) {
      args.push('--label', 'auto-merge');
    }

    const env = { ...process.env, GH_TOKEN: this.appConfig.ghToken };
    const cwd = this.appConfig.vaultPath;

    // Boundary try/catch: design/git-ops.md §3.6 mandates idempotent fallback
    // when a PR already exists for the branch. ENOENT and auth failures map
    // to typed ErrorCodes; anything else bubbles.
    let stdout: string;
    try {
      const result = await execFileAsync('gh', args, { cwd, env });
      stdout = result.stdout;
    } catch (err) {
      const errno = err as NodeJS.ErrnoException & { stderr?: string };
      if (errno.code === 'ENOENT') {
        throw new InternalException(ErrorCode.GIT_OPS_GH_CLI_MISSING, 'gh CLI not found on PATH — ensure the production image installs github-cli');
      }
      const stderr = typeof errno.stderr === 'string' ? errno.stderr : '';
      if (GH_EXISTING_PR_STDERR_REGEX.test(stderr)) {
        const existingUrl = await this.fetchExistingPrUrl(opts.branch, cwd, env);
        this.logger.log({
          message: 'git ops create pull request idempotent — existing PR URL reused',
          event: 'gitOps.createPullRequest.idempotent',
          branch: opts.branch,
        });
        return { url: existingUrl };
      }
      throw new InternalException(ErrorCode.GIT_OPS_PR_CREATION_FAILED, `gh pr create failed for branch '${opts.branch}': ${stderr.slice(0, 200)}`);
    }

    const url = stdout.trim();
    this.logger.log({
      message: 'git ops create pull request completed',
      event: 'gitOps.createPullRequest.completed',
      branch: opts.branch,
      autoMerge: opts.autoMerge,
      urlPath: this.safeUrlPath(url),
    });
    return { url };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async recoverFromStaleLocal(branch: string): Promise<void> {
    this.logger.warn({
      message: 'git ops push detected non-fast-forward — attempting rebase',
      event: 'gitOps.push.nonFastForward',
      branch,
      action: 'rebase',
    });
    await this.git.fetch('origin', 'main');
    // Boundary try/catch: rebase failures must abort cleanly and surface a
    // typed `GitOpsRebaseConflictError` so the dream activity can mark the
    // dream as failed (design/git-ops.md §5.1 + §5.3).
    try {
      await this.git.rebase(['origin/main']);
    } catch (rebaseErr) {
      // Best-effort cleanup — leave the working tree in a non-rebasing state
      // even if `--abort` itself fails (e.g. nothing to abort).
      await this.git.rebase(['--abort']).catch(() => undefined);
      const conflictedFiles = this.parseConflictedFiles(rebaseErr);
      throw new GitOpsRebaseConflictError(branch, conflictedFiles);
    }
    this.logger.log({
      message: 'git ops rebase succeeded',
      event: 'gitOps.push.rebaseSucceeded',
      branch,
    });
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

  private async fetchExistingPrUrl(branch: string, cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
    const { stdout } = await execFileAsync('gh', ['pr', 'list', '--head', branch, '--json', 'url', '--jq', '.[0].url'], { cwd, env });
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

  private previewMessage(message: string): string {
    return message.slice(0, 80);
  }

  private safeUrlPath(url: string): string {
    try {
      return new URL(url).pathname;
    } catch {
      // PR URL malformed — degrade to the raw URL rather than failing the
      // whole call. The PR was created; the log is best-effort.
      return url;
    }
  }
}
