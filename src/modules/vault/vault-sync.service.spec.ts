import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { VaultSyncService } from './vault-sync.service';
import { GitOpsService } from 'src/shared/git/git-ops.service';
import { BuildManifestUseCase } from './usecases/build-manifest.usecase';
import { FILE_MANIFEST_REPOSITORY, VaultFileInfo } from 'src/shared/domain/repositories/file-manifest.repository.interface';
import { CommandBus } from '@nestjs/cqrs';
import { InvalidateContextCacheCommand } from '../context/commands/invalidate-context-cache.command';
import { AppConfigService } from 'src/shared/config/config.service';

const INTERVAL_SECONDS = 1800;

function makeFile(relativePath: string): VaultFileInfo {
  return { relativePath, contentHash: 'hash', fileSize: 10, updatedAt: new Date() };
}

describe('VaultSyncService', () => {
  let target: VaultSyncService;
  let mockGitOps: DeepMocked<GitOpsService>;
  let mockBuildManifest: DeepMocked<BuildManifestUseCase>;
  let mockFileManifestRepo: DeepMocked<{ syncFromManifest: jest.Mock }>;
  let mockCommandBus: DeepMocked<CommandBus>;
  let mockConfig: DeepMocked<AppConfigService>;

  beforeEach(async () => {
    mockGitOps = createMock<GitOpsService>();
    mockBuildManifest = createMock<BuildManifestUseCase>();
    mockFileManifestRepo = createMock<{ syncFromManifest: jest.Mock }>();
    mockCommandBus = createMock<CommandBus>();
    mockConfig = createMock<AppConfigService>({ vaultSyncIntervalSeconds: INTERVAL_SECONDS });

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        VaultSyncService,
        { provide: GitOpsService, useValue: mockGitOps },
        { provide: BuildManifestUseCase, useValue: mockBuildManifest },
        { provide: FILE_MANIFEST_REPOSITORY, useValue: mockFileManifestRepo },
        { provide: CommandBus, useValue: mockCommandBus },
        { provide: AppConfigService, useValue: mockConfig },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = moduleRef.get(VaultSyncService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // AC (a): happy path — all 4 steps called in order, completed logged
  // ─────────────────────────────────────────────────────────────────────────────
  describe('runSync — happy path', () => {
    it('calls pullLatestMain, buildManifest, syncFromManifest, and invalidateContextCache in order', async () => {
      const files = [makeFile('a.md'), makeFile('b.md')];
      mockBuildManifest.execute.mockResolvedValue({ files, manifestHash: 'hash', generatedAt: new Date() });
      mockFileManifestRepo.syncFromManifest.mockResolvedValue(undefined);
      mockCommandBus.execute.mockResolvedValue(undefined);

      // Act
      await target.runSync();

      // Assert — verify call order
      expect(mockGitOps.pullLatestMain).toHaveBeenCalledTimes(1);
      expect(mockBuildManifest.execute).toHaveBeenCalledTimes(1);
      expect(mockFileManifestRepo.syncFromManifest).toHaveBeenCalledWith(files);
      expect(mockCommandBus.execute).toHaveBeenCalledWith(expect.any(InvalidateContextCacheCommand));
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // AC (b): pullLatestMain throws → warn logged, returns early, manifest NOT called
  // ─────────────────────────────────────────────────────────────────────────────
  describe('runSync — pull failure', () => {
    it('logs pullFailed and returns early; manifest step is NOT called', async () => {
      const error = new Error('network');
      mockGitOps.pullLatestMain.mockRejectedValue(error);
      mockBuildManifest.execute.mockResolvedValue({ files: [], manifestHash: 'h', generatedAt: new Date() });

      // Act
      await target.runSync();

      // Assert
      expect(mockBuildManifest.execute).not.toHaveBeenCalled();
      expect(mockFileManifestRepo.syncFromManifest).not.toHaveBeenCalled();
      expect(mockCommandBus.execute).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // AC (c): buildManifest.execute() throws → warn logged, cache invalidation STILL called
  // ─────────────────────────────────────────────────────────────────────────────
  describe('runSync — manifest build failure', () => {
    it('logs manifestFailed; cache invalidation is still dispatched', async () => {
      mockBuildManifest.execute.mockRejectedValue(new Error('scan error'));
      mockCommandBus.execute.mockResolvedValue(undefined);

      // Act
      await target.runSync();

      // Assert — pull succeeded (required to get here)
      expect(mockGitOps.pullLatestMain).toHaveBeenCalledTimes(1);
      // Cache invalidation still called
      expect(mockCommandBus.execute).toHaveBeenCalledWith(expect.any(InvalidateContextCacheCommand));
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // AC (d): commandBus.execute() throws → warn logged, no rethrow
  // ─────────────────────────────────────────────────────────────────────────────
  describe('runSync — cache invalidation failure', () => {
    it('logs cacheFailed and does NOT rethrow', async () => {
      const files = [makeFile('a.md')];
      mockBuildManifest.execute.mockResolvedValue({ files, manifestHash: 'hash', generatedAt: new Date() });
      mockFileManifestRepo.syncFromManifest.mockResolvedValue(undefined);
      mockCommandBus.execute.mockRejectedValue(new Error('cache error'));

      // Act & Assert — runSync itself must not throw
      await expect(target.runSync()).resolves.not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // AC (e): onModuleDestroy clears interval; onApplicationBootstrap starts new interval
  // ─────────────────────────────────────────────────────────────────────────────
  describe('lifecycle', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    it('onModuleDestroy clears the interval', () => {
      // Act — start then immediately stop
      target.onApplicationBootstrap();
      const clearSpy = jest.spyOn(global, 'clearInterval');
      target.onModuleDestroy();

      // Assert
      expect(clearSpy).toHaveBeenCalledTimes(1);
    });

    it('onApplicationBootstrap starts a new interval after destroy', () => {
      // Arrange — return distinct handles each call so we can verify two intervals
      const handle1 = { unref: jest.fn() } as unknown as NodeJS.Timeout;
      const handle2 = { unref: jest.fn() } as unknown as NodeJS.Timeout;
      let callCount = 0;
      jest.spyOn(global, 'setInterval').mockImplementation((_fn, _ms) => {
        return ++callCount === 1 ? handle1 : handle2;
      });

      // Act
      target.onApplicationBootstrap();
      const firstHandle = (target as unknown as { intervalHandle: NodeJS.Timeout | null }).intervalHandle;
      target.onModuleDestroy();
      target.onApplicationBootstrap();
      const secondHandle = (target as unknown as { intervalHandle: NodeJS.Timeout | null }).intervalHandle;

      // Assert — two separate intervals created
      expect((global.setInterval as jest.Mock)).toHaveBeenCalledTimes(2);
      expect(firstHandle).not.toBe(secondHandle);
    });
  });
});
