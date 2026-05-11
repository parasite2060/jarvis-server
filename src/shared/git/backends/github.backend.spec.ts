/**
 * Unit specs for `GitHubGitOpsBackend`.
 *
 * Tests the 'github' storage backend: commit + push + PR via gh CLI.
 * Mocks simple-git, fs/promises, and child_process.execFile at module level.
 */
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import * as fs from 'node:fs/promises';
import * as childProcess from 'node:child_process';
import simpleGit, { type SimpleGit } from 'simple-git';
import { ErrorCode } from 'src/utils/error.code';
import { GitOpsRebaseConflictError } from '../errors';
import { GitHubGitOpsBackend } from './github.backend';

jest.mock('simple-git');
jest.mock('node:fs/promises');
jest.mock('node:child_process', () => ({ __esModule: true, execFile: jest.fn() }));

const VAULT_PATH = '/var/lib/jarvis/ai-memory';
const GH_TOKEN = 'fake-gh-token';

describe('GitHubGitOpsBackend', () => {
  let target: GitHubGitOpsBackend;
  let mockGit: DeepMocked<SimpleGit>;
  let mockedExecFile: jest.Mock;

  beforeEach(() => {
    mockGit = createMock<SimpleGit>();
    (simpleGit as jest.MockedFunction<typeof simpleGit>).mockReturnValue(mockGit);
    mockedExecFile = childProcess.execFile as unknown as jest.Mock;
    target = new GitHubGitOpsBackend(VAULT_PATH, GH_TOKEN);
  });

  afterEach(() => jest.clearAllMocks());

  // ── pullLatestMain ─────────────────────────────────────────────────────────

  describe('pullLatestMain', () => {
    it('should checkout main and pull origin/main with --ff-only when pullLatestMain is called', async () => {
      // Act
      await target.pullLatestMain();

      // Assert
      expect(mockGit.checkout).toHaveBeenCalledWith('main');
      expect(mockGit.pull).toHaveBeenCalledWith('origin', 'main', { '--ff-only': null });
    });

    it('should throw GIT_OPS_PULL_NON_FF when pull detects non-fast-forward divergence', async () => {
      // Arrange
      mockGit.pull.mockRejectedValueOnce(new Error('tip of your current branch is behind'));

      // Act & Assert
      await expect(target.pullLatestMain()).rejects.toMatchObject({ code: ErrorCode.GIT_OPS_PULL_NON_FF });
    });

    it('should bubble network errors unchanged when pull fails with ENOTFOUND', async () => {
      // Arrange
      const netErr = new Error('getaddrinfo ENOTFOUND');
      mockGit.pull.mockRejectedValueOnce(netErr);

      // Act & Assert
      await expect(target.pullLatestMain()).rejects.toBe(netErr);
    });
  });

  // ── createBranch ───────────────────────────────────────────────────────────

  describe('createBranch', () => {
    it('should call git raw checkout -B when createBranch is invoked', async () => {
      // Act
      await target.createBranch('dream/deep-2026-05-08');

      // Assert
      expect(mockGit.raw).toHaveBeenCalledWith(['checkout', '-B', 'dream/deep-2026-05-08']);
    });

    it('should be idempotent when createBranch is called twice with same name', async () => {
      // Act
      await target.createBranch('dream/x');
      await target.createBranch('dream/x');

      // Assert
      expect(mockGit.raw).toHaveBeenCalledTimes(2);
    });

    it.each`
      name
      ${''}
      ${'a'.repeat(201)}
      ${'../etc/passwd'}
      ${'-evil'}
      ${'feat\x00bad'}
      ${' feat/x'}
      ${'feat/x '}
    `('should throw GIT_OPS_BRANCH_NAME_INVALID when branch name is `$name`', async ({ name }: { name: string }) => {
      // Act & Assert
      await expect(target.createBranch(name)).rejects.toMatchObject({ code: ErrorCode.GIT_OPS_BRANCH_NAME_INVALID });
    });
  });

  // ── writeFiles ─────────────────────────────────────────────────────────────

  describe('writeFiles', () => {
    it('should write files atomically with .tmp rename and create parent dirs when writeFiles is called', async () => {
      // Arrange
      const changes = [
        { path: 'dailys/2026-05-08.md', content: '# Today' },
        { path: 'decisions/foo.md', content: '# Decision' },
      ];

      // Act
      await target.writeFiles(changes);

      // Assert
      expect(fs.mkdir).toHaveBeenCalledTimes(2);
      expect(fs.writeFile).toHaveBeenCalledTimes(2);
      expect(fs.rename).toHaveBeenCalledTimes(2);
      expect(fs.writeFile).toHaveBeenNthCalledWith(1, `${VAULT_PATH}/dailys/2026-05-08.md.tmp`, '# Today', 'utf-8');
      expect(fs.rename).toHaveBeenNthCalledWith(1, `${VAULT_PATH}/dailys/2026-05-08.md.tmp`, `${VAULT_PATH}/dailys/2026-05-08.md`);
    });

    it('should write identical files twice when retrying idempotent writeFiles', async () => {
      // Arrange
      const changes = [{ path: 'a.md', content: 'x' }];

      // Act
      await target.writeFiles(changes);
      await target.writeFiles(changes);

      // Assert
      expect(fs.writeFile).toHaveBeenCalledTimes(2);
      expect(fs.rename).toHaveBeenCalledTimes(2);
    });

    it('should reject path traversal with GIT_OPS_VAULT_PATH_INVALID before calling filesystem', async () => {
      // Act & Assert
      await expect(target.writeFiles([{ path: '../etc/passwd', content: 'pwn' }])).rejects.toMatchObject({
        code: ErrorCode.GIT_OPS_VAULT_PATH_INVALID,
      });
      expect(fs.writeFile).not.toHaveBeenCalled();
    });
  });

  // ── commit ─────────────────────────────────────────────────────────────────

  describe('commit', () => {
    it('should stage files, commit, and log sha when commit is called with staged changes', async () => {
      // Arrange
      mockGit.status.mockResolvedValueOnce({ staged: ['a.md'] } as unknown as Awaited<ReturnType<typeof mockGit.status>>);
      mockGit.revparse.mockResolvedValueOnce('abcdef0123456789\n');

      // Act
      await target.commit('dream(light): x', ['a.md']);

      // Assert
      expect(mockGit.add).toHaveBeenCalledWith(['a.md']);
      expect(mockGit.commit).toHaveBeenCalledWith('dream(light): x', ['a.md']);
      expect(mockGit.revparse).toHaveBeenCalledWith(['HEAD']);
    });

    it('should skip commit when nothing is staged to handle Temporal retry idempotency', async () => {
      // Arrange
      mockGit.status.mockResolvedValueOnce({ staged: [] } as unknown as Awaited<ReturnType<typeof mockGit.status>>);

      // Act
      await target.commit('noop', ['a.md']);

      // Assert
      expect(mockGit.commit).not.toHaveBeenCalled();
    });

    it('should throw GIT_OPS_FORBIDDEN_TRAILER when commit message contains Co-Authored-By: Claude trailer', async () => {
      // Act & Assert
      await expect(target.commit('feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>', ['a.md'])).rejects.toMatchObject({
        code: ErrorCode.GIT_OPS_FORBIDDEN_TRAILER,
      });
      expect(mockGit.add).not.toHaveBeenCalled();
    });
  });

  // ── push ───────────────────────────────────────────────────────────────────

  describe('push', () => {
    it('should push to origin with -u flag when first push succeeds', async () => {
      // Act
      await target.push('dream/deep-x');

      // Assert
      expect(mockGit.push).toHaveBeenCalledWith('origin', 'dream/deep-x', { '-u': null });
    });

    it('should rebase onto origin/main and retry push once when non-fast-forward error occurs', async () => {
      // Arrange
      const nonFfErr = new Error('! [rejected] non-fast-forward');
      mockGit.push.mockRejectedValueOnce(nonFfErr).mockResolvedValueOnce({} as never);

      // Act
      await target.push('dream/deep-x');

      // Assert
      expect(mockGit.fetch).toHaveBeenCalledWith('origin', 'main');
      expect(mockGit.rebase).toHaveBeenCalledWith(['origin/main']);
      expect(mockGit.push).toHaveBeenCalledTimes(2);
    });

    it('should abort rebase and throw GitOpsRebaseConflictError when rebase conflict occurs', async () => {
      // Arrange
      mockGit.push.mockRejectedValueOnce(new Error('non-fast-forward'));
      mockGit.rebase
        .mockRejectedValueOnce(Object.assign(new Error('CONFLICT (content): Merge conflict in MEMORY.md'), { name: 'GitError' }))
        .mockResolvedValueOnce('' as never);

      // Act & Assert
      await expect(target.push('dream/conflict')).rejects.toBeInstanceOf(GitOpsRebaseConflictError);
      expect(mockGit.rebase).toHaveBeenCalledWith(['--abort']);
    });

    it('should parse conflicted file names correctly when rebase reports multiple conflicts', async () => {
      // Arrange
      mockGit.push.mockRejectedValueOnce(new Error('non-fast-forward'));
      mockGit.rebase
        .mockRejectedValueOnce(
          Object.assign(new Error('CONFLICT (content): Merge conflict in MEMORY.md\nCONFLICT (content): Merge conflict in dailys/2026-05-08.md'), {
            name: 'GitError',
          }),
        )
        .mockResolvedValueOnce('' as never);

      // Act & Assert
      await expect(target.push('dream/conflict')).rejects.toMatchObject({
        conflictedFiles: ['MEMORY.md', 'dailys/2026-05-08.md'],
      });
    });

    it('should bubble second non-FF error and stop when retry also fails non-FF (no loop)', async () => {
      // Arrange
      const err1 = new Error('non-fast-forward');
      const err2 = new Error('! [rejected]');
      mockGit.push.mockRejectedValueOnce(err1).mockRejectedValueOnce(err2);

      // Act & Assert
      await expect(target.push('dream/loop')).rejects.toBe(err2);
      expect(mockGit.push).toHaveBeenCalledTimes(2);
    });

    it('should bubble non-network errors unchanged when push fails with auth error', async () => {
      // Arrange
      const authErr = new Error('fatal: Authentication failed');
      mockGit.push.mockRejectedValueOnce(authErr);

      // Act & Assert
      await expect(target.push('dream/x')).rejects.toBe(authErr);
    });
  });

  // ── createPullRequest ──────────────────────────────────────────────────────

  describe('createPullRequest', () => {
    it('should call gh pr create with correct argv and return trimmed URL when PR is created', async () => {
      // Arrange
      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (e: Error | null, r: { stdout: string; stderr: string }) => void) => {
          cb(null, { stdout: 'https://github.com/parasite2060/ai-memory/pull/123\n', stderr: '' });
        },
      );

      // Act
      const result = await target.createPullRequest({
        branch: 'dream/deep-x',
        title: 'dream(deep): x',
        body: 'body',
        autoMerge: false,
      });

      // Assert
      expect(result).toEqual({ url: 'https://github.com/parasite2060/ai-memory/pull/123' });
      const [cmd, args, opts] = mockedExecFile.mock.calls[0]!;
      expect(cmd).toBe('gh');
      expect(args).toEqual(['pr', 'create', '--head', 'dream/deep-x', '--base', 'main', '--title', 'dream(deep): x', '--body', 'body']);
      expect((opts as { cwd: string }).cwd).toBe(VAULT_PATH);
      expect((opts as { env: Record<string, string> }).env['GH_TOKEN']).toBe(GH_TOKEN);
    });

    it('should append --label auto-merge when autoMerge is true', async () => {
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

    it('should fetch existing PR URL via gh pr list when PR already exists (idempotent fallback)', async () => {
      // Arrange
      mockedExecFile
        .mockImplementationOnce(
          (_cmd: string, _args: string[], _opts: unknown, cb: (e: Error | null, r: { stdout: string; stderr: string }) => void) => {
            const err = Object.assign(new Error('gh pr create failed'), {
              code: 1,
              stderr: 'a pull request for branch "dream/deep-x" already exists:',
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
      const result = await target.createPullRequest({ branch: 'dream/deep-x', title: 't', body: 'b', autoMerge: false });

      // Assert
      expect(result.url).toBe('https://github.com/x/y/pull/9');
      const [, listArgs] = mockedExecFile.mock.calls[1]!;
      expect(listArgs).toEqual(['pr', 'list', '--head', 'dream/deep-x', '--json', 'url', '--jq', '.[0].url']);
    });

    it('should throw GIT_OPS_GH_CLI_MISSING when gh binary is not found (ENOENT)', async () => {
      // Arrange
      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (e: Error | null, r: { stdout: string; stderr: string }) => void) => {
          cb(Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }), { stdout: '', stderr: '' });
        },
      );

      // Act & Assert
      await expect(target.createPullRequest({ branch: 'b', title: 't', body: 'b', autoMerge: false })).rejects.toMatchObject({
        code: ErrorCode.GIT_OPS_GH_CLI_MISSING,
      });
    });

    it('should throw GIT_OPS_PR_CREATION_FAILED when gh pr create fails with auth error', async () => {
      // Arrange
      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (e: Error | null, r: { stdout: string; stderr: string }) => void) => {
          cb(Object.assign(new Error('gh pr create failed'), { code: 1, stderr: 'HTTP 401: Bad credentials' }), { stdout: '', stderr: '' });
        },
      );

      // Act & Assert
      await expect(target.createPullRequest({ branch: 'b', title: 't', body: 'b', autoMerge: false })).rejects.toMatchObject({
        code: ErrorCode.GIT_OPS_PR_CREATION_FAILED,
      });
    });
  });

  // ── mergeBranch ─────────────────────────────────────────────────────────────

  describe('mergeBranch', () => {
    it('should be a no-op when mergeBranch is called in github mode', async () => {
      // Act
      await expect(target.mergeBranch('dream/deep-x')).resolves.toBeUndefined();

      // Assert
      expect(mockGit.checkout).not.toHaveBeenCalled();
      expect(mockGit.merge).not.toHaveBeenCalled();
    });
  });

  // ── fetchOriginMain ─────────────────────────────────────────────────────────

  describe('fetchOriginMain', () => {
    it('should fetch origin/main when fetchOriginMain is called', async () => {
      // Act
      await target.fetchOriginMain();

      // Assert
      expect(mockGit.fetch).toHaveBeenCalledWith('origin', 'main');
    });
  });
});
