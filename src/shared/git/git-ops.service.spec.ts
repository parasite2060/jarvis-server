/**
 * Unit specs for `GitOpsService` (facade) and `GitOpsBackendFactory`.
 *
 * GitOpsService is a thin facade: it delegates every call to
 * factory.getBackend(memoryStorageMode).  Simple-git, fs, and execFile are
 * mocked module-wide so backends can be tested in isolation.
 */
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { AppConfigService } from 'src/shared/config/config.service';
import { GitOpsService } from './git-ops.service';
import { GitOpsBackendFactory } from './git-ops-backend.factory';
import { IGitOpsBackend } from './backends/git-ops.backend';

// ─── GitOpsService spec ───────────────────────────────────────────────────────

describe('GitOpsService', () => {
  let target: GitOpsService;
  let mockFactory: DeepMocked<GitOpsBackendFactory>;

  beforeEach(() => {
    mockFactory = createMock<GitOpsBackendFactory>();

    const mockAppConfig = createMock<AppConfigService>();
    Object.defineProperty(mockAppConfig, 'memoryStorageMode', { value: 'local', configurable: true });

    target = new GitOpsService(mockFactory as unknown as GitOpsBackendFactory, mockAppConfig as unknown as AppConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  describe('pullLatestMain', () => {
    it('should delegate to the local backend when memoryStorageMode is local', async () => {
      // Arrange
      mockFactory.getBackend.mockReturnValue({
        pullLatestMain: jest.fn().mockResolvedValue(undefined),
      } as unknown as IGitOpsBackend);

      // Act
      await target.pullLatestMain();

      // Assert
      expect(mockFactory.getBackend).toHaveBeenCalledWith('local');
      expect(mockFactory.getBackend('local')!.pullLatestMain).toHaveBeenCalledTimes(1);
    });

    it('should delegate to the github backend when memoryStorageMode is github', async () => {
      // Arrange
      const mockAppConfig = createMock<AppConfigService>();
      Object.defineProperty(mockAppConfig, 'memoryStorageMode', { value: 'github', configurable: true });
      target = new GitOpsService(mockFactory as unknown as GitOpsBackendFactory, mockAppConfig as unknown as AppConfigService);

      // Act
      await target.pullLatestMain();

      // Assert
      expect(mockFactory.getBackend).toHaveBeenCalledWith('github');
    });
  });

  describe('createBranch', () => {
    it('should delegate branch creation to the active backend when createBranch is called', async () => {
      // Arrange
      const branchName = 'dream/deep-2026-05-08';
      mockFactory.getBackend.mockReturnValue({
        createBranch: jest.fn().mockResolvedValue(undefined),
      } as unknown as IGitOpsBackend);

      // Act
      await target.createBranch(branchName);

      // Assert
      expect(mockFactory.getBackend('local')!.createBranch).toHaveBeenCalledWith(branchName);
    });
  });

  describe('writeFiles', () => {
    it('should delegate writeFiles to the active backend when writeFiles is called', async () => {
      // Arrange
      const changes = [{ path: 'dailys/2026-05-08.md', content: '# Today' }];
      mockFactory.getBackend.mockReturnValue({
        writeFiles: jest.fn().mockResolvedValue(undefined),
      } as unknown as IGitOpsBackend);

      // Act
      await target.writeFiles(changes);

      // Assert
      expect(mockFactory.getBackend('local')!.writeFiles).toHaveBeenCalledWith(changes);
    });
  });

  describe('commit', () => {
    it('should delegate commit to the active backend when commit is called', async () => {
      // Arrange
      const message = 'feat: x';
      const paths = ['a.md'];
      mockFactory.getBackend.mockReturnValue({
        commit: jest.fn().mockResolvedValue(undefined),
      } as unknown as IGitOpsBackend);

      // Act
      await target.commit(message, paths);

      // Assert
      expect(mockFactory.getBackend('local')!.commit).toHaveBeenCalledWith(message, paths);
    });
  });

  describe('push', () => {
    it('should delegate push to the active backend when push is called', async () => {
      // Arrange
      const branch = 'dream/deep-x';
      mockFactory.getBackend.mockReturnValue({
        push: jest.fn().mockResolvedValue(undefined),
      } as unknown as IGitOpsBackend);

      // Act
      await target.push(branch);

      // Assert
      expect(mockFactory.getBackend('local')!.push).toHaveBeenCalledWith(branch);
    });
  });

  describe('createPullRequest', () => {
    it('should delegate createPullRequest to the github backend when memoryStorageMode is github', async () => {
      // Arrange
      const opts = { branch: 'b', title: 't', body: 'b', autoMerge: false };
      const mockAppConfig = createMock<AppConfigService>();
      Object.defineProperty(mockAppConfig, 'memoryStorageMode', { value: 'github', configurable: true });
      target = new GitOpsService(mockFactory as unknown as GitOpsBackendFactory, mockAppConfig as unknown as AppConfigService);

      // Act
      await target.createPullRequest(opts);

      // Assert
      expect(mockFactory.getBackend).toHaveBeenCalledWith('github');
    });
  });

  describe('mergeBranch', () => {
    it('should delegate mergeBranch to the local backend when memoryStorageMode is local', async () => {
      // Arrange
      const branch = 'dream/deep-2026-05-08';
      mockFactory.getBackend.mockReturnValue({
        mergeBranch: jest.fn().mockResolvedValue(undefined),
      } as unknown as IGitOpsBackend);

      // Act
      await target.mergeBranch(branch);

      // Assert
      expect(mockFactory.getBackend('local')!.mergeBranch).toHaveBeenCalledWith(branch);
    });
  });
});

// ─── GitOpsBackendFactory spec ───────────────────────────────────────────────

describe('GitOpsBackendFactory', () => {
  let factory: GitOpsBackendFactory;

  beforeEach(() => {
    const mockLocal = createMock<IGitOpsBackend>({ mode: 'local' as const });
    const mockGitHub = createMock<IGitOpsBackend>({ mode: 'github' as const });
    factory = new GitOpsBackendFactory(mockLocal as unknown as IGitOpsBackend, mockGitHub as unknown as IGitOpsBackend);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getBackend', () => {
    it('should return the local backend when mode is local', () => {
      // Act
      const result = factory.getBackend('local');

      // Assert
      expect(result).toBeDefined();
      expect(result.mode).toBe('local');
    });

    it('should return the github backend when mode is github', () => {
      // Act
      const result = factory.getBackend('github');

      // Assert
      expect(result).toBeDefined();
      expect(result.mode).toBe('github');
    });

    it('should fall back to the local backend when mode is unknown', () => {
      // Act
      // @ts-expect-error testing runtime fallback for invalid string literal
      const result = factory.getBackend('gitlab');

      // Assert
      expect(result.mode).toBe('local');
    });
  });
});
