/**
 * Unit specs for `GitOpsService` (Story 13.7).
 *
 * Coverage targets the six public methods + private helpers + idempotent-retry
 * paths per AC #13. `simple-git`, `child_process.execFile`, and `fs/promises`
 * are mocked module-wide; `AppConfigService` mocked via `@golevelup/ts-jest`.
 */
import { Logger } from '@nestjs/common';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import simpleGit, { type SimpleGit } from 'simple-git';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { AppConfigService } from 'src/shared/config/config.service';
import { ErrorCode } from 'src/utils/error.code';
import { InternalException } from 'src/shared/common/models/exception';
import { GitOpsRebaseConflictError } from './errors';
import { GitOpsService } from './git-ops.service';

jest.mock('simple-git');
jest.mock('node:fs/promises');
jest.mock('node:child_process', () => ({
  __esModule: true,
  execFile: jest.fn(),
}));

const VAULT_PATH = '/var/lib/jarvis/ai-memory';
const GH_TOKEN = 'fake-gh-token';

describe('GitOpsService', () => {
  let target: GitOpsService;
  let mockAppConfig: DeepMocked<AppConfigService>;
  let mockGit: DeepMocked<SimpleGit>;
  let logSpyLog: jest.SpyInstance;
  let logSpyWarn: jest.SpyInstance;
  let logSpyError: jest.SpyInstance;

  beforeEach(() => {
    // Arrange: mocks
    mockAppConfig = createMock<AppConfigService>();
    Object.defineProperty(mockAppConfig, 'vaultPath', { value: VAULT_PATH, configurable: true });
    Object.defineProperty(mockAppConfig, 'ghToken', { value: GH_TOKEN, configurable: true });

    mockGit = createMock<SimpleGit>();
    (simpleGit as jest.MockedFunction<typeof simpleGit>).mockReturnValue(mockGit);

    logSpyLog = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    logSpyWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    logSpyError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    target = new GitOpsService(mockAppConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
    logSpyLog.mockRestore();
    logSpyWarn.mockRestore();
    logSpyError.mockRestore();
  });

  // ---------------------------------------------------------------------------
  describe('pullLatestMain', () => {
    it('checks out main, pulls --ff-only, and logs the completion event', async () => {
      // Act
      await target.pullLatestMain();

      // Assert
      expect(mockGit.checkout).toHaveBeenCalledWith('main');
      expect(mockGit.pull).toHaveBeenCalledWith('origin', 'main', { '--ff-only': null });
      expect(logSpyLog).toHaveBeenCalledWith(expect.objectContaining({ event: 'gitOps.pullLatestMain.completed', baseDir: VAULT_PATH }));
    });

    it('throws InternalException(GIT_OPS_PULL_NON_FF) when pull rejects with non-FF', async () => {
      // Arrange
      mockGit.pull.mockRejectedValueOnce(new Error('fatal: Not possible to fast-forward, aborting. tip of your current branch is behind'));

      // Act + Assert
      await expect(target.pullLatestMain()).rejects.toMatchObject({
        code: ErrorCode.GIT_OPS_PULL_NON_FF,
      });
    });

    it('bubbles network errors unchanged for Temporal retry-with-backoff', async () => {
      // Arrange
      const networkErr = new Error('getaddrinfo ENOTFOUND github.com');
      mockGit.pull.mockRejectedValueOnce(networkErr);

      // Act + Assert
      await expect(target.pullLatestMain()).rejects.toBe(networkErr);
    });
  });

  // ---------------------------------------------------------------------------
  describe('createBranch', () => {
    it('checks out -B with the given name and logs the completion event', async () => {
      // Act
      await target.createBranch('dream/light-2026-05-08-153042');

      // Assert
      expect(mockGit.raw).toHaveBeenCalledWith(['checkout', '-B', 'dream/light-2026-05-08-153042']);
      expect(logSpyLog).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'gitOps.createBranch.completed', name: 'dream/light-2026-05-08-153042' }),
      );
    });

    it('is idempotent on Temporal retry — second call still uses -B', async () => {
      // Act
      await target.createBranch('dream/light-x');
      await target.createBranch('dream/light-x');

      // Assert
      expect(mockGit.raw).toHaveBeenCalledTimes(2);
      expect(mockGit.raw).toHaveBeenNthCalledWith(2, ['checkout', '-B', 'dream/light-x']);
    });

    it.each([
      ['contains ..', '../etc/passwd'],
      ['leading dash (would be parsed as a flag)', '-evil'],
      ['null byte (control char)', 'feat\x00bad'],
      ['leading whitespace', ' feat/13-7'],
      ['trailing whitespace', 'feat/13-7 '],
      ['exceeds 200 chars', 'a'.repeat(201)],
    ])('rejects invalid branch name (%s) with GIT_OPS_BRANCH_NAME_INVALID before calling git', async (_desc, name) => {
      // Act + Assert
      await expect(target.createBranch(name)).rejects.toMatchObject({
        code: ErrorCode.GIT_OPS_BRANCH_NAME_INVALID,
      });
      expect(mockGit.raw).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  describe('writeFiles', () => {
    it('writes each file atomically (.tmp then rename) under the vault root and logs aggregate count only', async () => {
      // Arrange
      const changes = [
        { path: 'dailys/2026-05-08.md', content: '# Today\n' },
        { path: 'decisions/foo.md', content: '# Decision\n' },
      ];

      // Act
      await target.writeFiles(changes);

      // Assert: mkdir + atomic write + rename per file
      expect(fs.mkdir).toHaveBeenCalledTimes(2);
      expect(fs.writeFile).toHaveBeenCalledTimes(2);
      expect(fs.rename).toHaveBeenCalledTimes(2);
      expect(fs.writeFile).toHaveBeenNthCalledWith(1, `${VAULT_PATH}/dailys/2026-05-08.md.tmp`, '# Today\n', 'utf-8');
      expect(fs.rename).toHaveBeenNthCalledWith(1, `${VAULT_PATH}/dailys/2026-05-08.md.tmp`, `${VAULT_PATH}/dailys/2026-05-08.md`);
      // Log emits aggregate count, never per-file content or paths.
      expect(logSpyLog).toHaveBeenCalledWith(expect.objectContaining({ event: 'gitOps.writeFiles.completed', count: 2 }));
      expect(logSpyLog.mock.calls[0]![0]).not.toHaveProperty('content');
    });

    it('idempotent retry — same content twice produces identical FS sequence', async () => {
      // Arrange
      const changes = [{ path: 'a.md', content: 'x' }];

      // Act
      await target.writeFiles(changes);
      await target.writeFiles(changes);

      // Assert
      expect(fs.writeFile).toHaveBeenCalledTimes(2);
      expect(fs.rename).toHaveBeenCalledTimes(2);
    });

    it('rejects path-traversal attempt with GIT_OPS_VAULT_PATH_INVALID before any FS call', async () => {
      // Act + Assert
      await expect(target.writeFiles([{ path: '../etc/passwd', content: 'pwn' }])).rejects.toMatchObject({
        code: ErrorCode.GIT_OPS_VAULT_PATH_INVALID,
      });
      expect(fs.writeFile).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  describe('commit', () => {
    it('adds explicit paths, commits, captures HEAD sha, and logs 7-char abbrev', async () => {
      // Arrange
      mockGit.status.mockResolvedValueOnce({
        staged: ['dailys/2026-05-08.md'],
      } as unknown as Awaited<ReturnType<typeof mockGit.status>>);
      mockGit.revparse.mockResolvedValueOnce('abcdef0123456789\n');

      // Act
      await target.commit('dream(light): extract session 2026-05-08 15:30', ['dailys/2026-05-08.md']);

      // Assert
      expect(mockGit.add).toHaveBeenCalledWith(['dailys/2026-05-08.md']);
      expect(mockGit.commit).toHaveBeenCalledWith('dream(light): extract session 2026-05-08 15:30', ['dailys/2026-05-08.md']);
      expect(logSpyLog).toHaveBeenCalledWith(expect.objectContaining({ event: 'gitOps.commit.completed', paths: 1, sha: 'abcdef0' }));
    });

    it('skips commit when status reports zero staged files (Temporal retry idempotency)', async () => {
      // Arrange — clean tree after add
      mockGit.status.mockResolvedValueOnce({ staged: [] } as unknown as Awaited<ReturnType<typeof mockGit.status>>);

      // Act
      await target.commit('dream(light): noop', ['some/file.md']);

      // Assert
      expect(mockGit.add).toHaveBeenCalledTimes(1);
      expect(mockGit.commit).not.toHaveBeenCalled();
      expect(logSpyLog).toHaveBeenCalledWith(expect.objectContaining({ event: 'gitOps.commit.skipped', reason: 'noChanges' }));
    });

    it('throws GIT_OPS_FORBIDDEN_TRAILER when message contains Co-Authored-By: Claude (case-insensitive)', async () => {
      // Act + Assert
      await expect(target.commit('feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>', ['x.md'])).rejects.toMatchObject({
        code: ErrorCode.GIT_OPS_FORBIDDEN_TRAILER,
      });
      expect(mockGit.add).not.toHaveBeenCalled();
    });

    it('throws GIT_OPS_FORBIDDEN_TRAILER for the AI variant on a body line (m flag)', async () => {
      // Act + Assert — multi-line body with the trailer NOT on the first line
      await expect(target.commit('subject\n\nbody\nco-authored-by: AI <ai@ai.dev>', ['x.md'])).rejects.toMatchObject({
        code: ErrorCode.GIT_OPS_FORBIDDEN_TRAILER,
      });
    });

    it('does NOT throw when the substring "Co-Authored-By:" appears mid-line (regex is line-anchored)', async () => {
      // Arrange
      mockGit.status.mockResolvedValueOnce({ staged: ['x.md'] } as unknown as Awaited<ReturnType<typeof mockGit.status>>);
      mockGit.revparse.mockResolvedValueOnce('1234567');

      // Act — mid-line is not anchored; the safe message commits cleanly.
      await target.commit('discuss Co-Authored-By: Claude in body inline', ['x.md']);

      // Assert
      expect(mockGit.commit).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  describe('push', () => {
    it('pushes the branch with -u and logs gitOps.push.completed on first-try success', async () => {
      // Act
      await target.push('dream/light-x');

      // Assert
      expect(mockGit.push).toHaveBeenCalledWith('origin', 'dream/light-x', { '-u': null });
      expect(logSpyLog).toHaveBeenCalledWith(expect.objectContaining({ event: 'gitOps.push.completed', branch: 'dream/light-x' }));
    });

    it.each([
      ['non-fast-forward', '! [rejected] dream/x -> dream/x (non-fast-forward)'],
      ['! [rejected]', 'error: failed to push some refs ! [rejected] (fetch first)'],
      ['tip of your current branch is behind', 'hint: tip of your current branch is behind its remote counterpart'],
    ])('detects non-FF variant "%s", rebases, and retries push exactly once (gitOps.push.recovered)', async (_label, errMsg) => {
      // Arrange
      const nonFfErr = Object.assign(new Error(errMsg), { name: 'GitError' });
      mockGit.push.mockRejectedValueOnce(nonFfErr).mockResolvedValueOnce({} as never);

      // Act
      await target.push('dream/light-x');

      // Assert
      expect(mockGit.fetch).toHaveBeenCalledWith('origin', 'main');
      expect(mockGit.rebase).toHaveBeenCalledWith(['origin/main']);
      expect(mockGit.push).toHaveBeenCalledTimes(2);
      expect(logSpyLog).toHaveBeenCalledWith(expect.objectContaining({ event: 'gitOps.push.rebaseSucceeded', branch: 'dream/light-x' }));
      expect(logSpyLog).toHaveBeenCalledWith(expect.objectContaining({ event: 'gitOps.push.recovered', branch: 'dream/light-x' }));
    });

    it('on rebase conflict: aborts the rebase, parses conflicted files, throws GitOpsRebaseConflictError', async () => {
      // Arrange
      const nonFfErr = new Error('non-fast-forward');
      mockGit.push.mockRejectedValueOnce(nonFfErr);
      const rebaseErr = Object.assign(
        new Error('CONFLICT (content): Merge conflict in MEMORY.md\nCONFLICT (content): Merge conflict in dailys/2026-05-08.md'),
        { name: 'GitError' },
      );
      mockGit.rebase.mockImplementation((args: string[] | unknown) => {
        if (Array.isArray(args) && args[0] === '--abort') return Promise.resolve('') as never;
        return Promise.reject(rebaseErr) as never;
      });

      // Act + Assert — class type, code, branch, and conflictedFiles in one go
      await expect(target.push('dream/conflict')).rejects.toBeInstanceOf(GitOpsRebaseConflictError);
      // Re-mock the push rejection for the second invocation (mockRejectedValueOnce was consumed).
      mockGit.push.mockRejectedValueOnce(nonFfErr);
      await expect(target.push('dream/conflict-2')).rejects.toMatchObject({
        code: ErrorCode.GIT_OPS_REBASE_CONFLICT,
        branch: 'dream/conflict-2',
        conflictedFiles: ['MEMORY.md', 'dailys/2026-05-08.md'],
      });
    });

    it('does NOT loop when the retried push (after a successful rebase) ALSO fails non-FF', async () => {
      // Arrange
      const nonFfErr = new Error('non-fast-forward');
      const nonFfErr2 = new Error('! [rejected]');
      mockGit.push.mockRejectedValueOnce(nonFfErr).mockRejectedValueOnce(nonFfErr2);

      // Act + Assert — second non-FF bubbles unchanged
      await expect(target.push('dream/loop')).rejects.toBe(nonFfErr2);
      expect(mockGit.push).toHaveBeenCalledTimes(2);
    });

    it('bubbles auth/repo errors unchanged and logs gitOps.push.failed', async () => {
      // Arrange
      const authErr = Object.assign(new Error('fatal: Authentication failed for ai-memory'), { name: 'AuthError' });
      mockGit.push.mockRejectedValueOnce(authErr);

      // Act + Assert
      await expect(target.push('dream/x')).rejects.toBe(authErr);
      expect(logSpyError).toHaveBeenCalledWith(expect.objectContaining({ event: 'gitOps.push.failed', branch: 'dream/x', errorClass: 'AuthError' }));
      // No fetch/rebase attempted — only first push call.
      expect(mockGit.fetch).not.toHaveBeenCalled();
      expect(mockGit.rebase).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  describe('createPullRequest', () => {
    const mockedExecFile = execFile as unknown as jest.Mock;

    it('shells gh with strict argv (no --label without autoMerge), returns trimmed URL, logs urlPath', async () => {
      // Arrange
      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (e: Error | null, r: { stdout: string; stderr: string }) => void) => {
          cb(null, { stdout: 'https://github.com/parasite2060/ai-memory/pull/123\n', stderr: '' });
        },
      );

      // Act
      const result = await target.createPullRequest({
        branch: 'dream/light-x',
        title: 'dream(light): x',
        body: 'body',
        autoMerge: false,
      });

      // Assert
      expect(result).toEqual({ url: 'https://github.com/parasite2060/ai-memory/pull/123' });
      const [cmd, args, opts] = mockedExecFile.mock.calls[0]!;
      expect(cmd).toBe('gh');
      expect(Array.isArray(args)).toBe(true);
      expect(args).toEqual(['pr', 'create', '--head', 'dream/light-x', '--base', 'main', '--title', 'dream(light): x', '--body', 'body']);
      expect((opts as { cwd: string }).cwd).toBe(VAULT_PATH);
      expect((opts as { env: Record<string, string> }).env['GH_TOKEN']).toBe(GH_TOKEN);
      expect(logSpyLog).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'gitOps.createPullRequest.completed',
          branch: 'dream/light-x',
          autoMerge: false,
          urlPath: '/parasite2060/ai-memory/pull/123',
        }),
      );
    });

    it('appends --label auto-merge only when autoMerge=true', async () => {
      // Arrange
      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (e: Error | null, r: { stdout: string; stderr: string }) => void) => {
          cb(null, { stdout: 'https://github.com/x/y/pull/1', stderr: '' });
        },
      );

      // Act
      await target.createPullRequest({ branch: 'b', title: 't', body: 'b', autoMerge: true });

      // Assert
      const [, args] = mockedExecFile.mock.calls[0]!;
      expect(args).toEqual(expect.arrayContaining(['--label', 'auto-merge']));
    });

    it('idempotent fallback when an existing PR is detected — returns existing URL via gh pr list', async () => {
      // Arrange
      mockedExecFile
        .mockImplementationOnce(
          (_cmd: string, _args: string[], _opts: unknown, cb: (e: Error | null, r: { stdout: string; stderr: string }) => void) => {
            const err = Object.assign(new Error('gh pr create failed'), {
              code: 1,
              stderr: 'a pull request for branch "dream/light-x" already exists:',
              stdout: '',
            });
            cb(err as Error, { stdout: '', stderr: err.stderr as string });
          },
        )
        .mockImplementationOnce(
          (_cmd: string, _args: string[], _opts: unknown, cb: (e: Error | null, r: { stdout: string; stderr: string }) => void) => {
            cb(null, { stdout: 'https://github.com/x/y/pull/9\n', stderr: '' });
          },
        );

      // Act
      const result = await target.createPullRequest({ branch: 'dream/light-x', title: 't', body: 'b', autoMerge: false });

      // Assert
      expect(result.url).toBe('https://github.com/x/y/pull/9');
      const [, args] = mockedExecFile.mock.calls[1]!;
      expect(args).toEqual(['pr', 'list', '--head', 'dream/light-x', '--json', 'url', '--jq', '.[0].url']);
      expect(logSpyLog).toHaveBeenCalledWith(expect.objectContaining({ event: 'gitOps.createPullRequest.idempotent', branch: 'dream/light-x' }));
    });

    it('throws GIT_OPS_GH_CLI_MISSING when gh binary is missing (ENOENT)', async () => {
      // Arrange
      mockedExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (e: Error | null) => void) => {
        const err = Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
        cb(err as Error);
      });

      // Act + Assert
      await expect(target.createPullRequest({ branch: 'b', title: 't', body: 'b', autoMerge: false })).rejects.toMatchObject({
        code: ErrorCode.GIT_OPS_GH_CLI_MISSING,
      });
    });

    it('throws GIT_OPS_PR_CREATION_FAILED with stderr preview on auth / repo-not-found', async () => {
      // Arrange
      mockedExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (e: Error | null) => void) => {
        const err = Object.assign(new Error('gh pr create failed'), {
          code: 1,
          stderr: 'HTTP 401: Bad credentials (https://api.github.com/repos)',
        });
        cb(err as Error);
      });

      // Act + Assert
      await expect(target.createPullRequest({ branch: 'b', title: 't', body: 'b', autoMerge: false })).rejects.toMatchObject({
        code: ErrorCode.GIT_OPS_PR_CREATION_FAILED,
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('error type fidelity', () => {
    it('every typed error inherits InternalException so the global filter (Story 13.1) can map it', async () => {
      // Act + Assert — `GitOpsRebaseConflictError` is the only dedicated class;
      // others throw `InternalException(ErrorCode.X)` directly.
      const err = new GitOpsRebaseConflictError('b', ['MEMORY.md']);
      expect(err).toBeInstanceOf(InternalException);
      expect(err.code).toBe(ErrorCode.GIT_OPS_REBASE_CONFLICT);
      expect(err.branch).toBe('b');
      expect(err.conflictedFiles).toEqual(['MEMORY.md']);
    });
  });
});
