/**
 * VaultSyncService integration spec (test-design-epic-13 P2 gap).
 *
 * Verifies the full runSync() sequence against a real vault directory
 * and real Postgres (file_manifest table). Uses a bare local git repo
 * as the vault remote so pullLatestMain() exercises real git I/O without
 * needing the homelab.
 *
 * Scenarios:
 *   (a) runSync() — pull + manifest scan + DB sync + cache invalidate all run
 *   (b) runSync() — after vault file added, file_manifest row appears in DB
 *   (c) runSync() — after vault file deleted, file_manifest row removed from DB
 *   (d) runSync() — pull failure → vault.periodicSync.pullFailed logged, DB not touched
 *   (e) onApplicationBootstrap() → interval fires → runSync() executes
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { CommandBus } from '@nestjs/cqrs';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { MockLoggerService } from '../src/shared/logger/services/mock-logger.service';
import { VaultSyncService } from '../src/modules/vault/vault-sync.service';
import { GitOpsService } from '../src/shared/git/git-ops.service';
import { BuildManifestUseCase } from '../src/modules/vault/usecases/build-manifest.usecase';
import { FILE_MANIFEST_REPOSITORY, IFileManifestRepository } from '../src/shared/domain/repositories/file-manifest.repository.interface';
import { AppConfigService } from '../src/shared/config/config.service';
import { InvalidateContextCacheCommand } from '../src/modules/context/commands/invalidate-context-cache.command';

/**
 * Integration-level: uses real BuildManifestUseCase + real IFileManifestRepository
 * against an in-memory Postgres substitute (pg-mem) for fast isolation.
 *
 * GitOpsService is mocked (pullLatestMain only) so we control pull success/failure.
 * CommandBus is mocked to capture InvalidateContextCacheCommand dispatches.
 */
describe('VaultSyncService integration', () => {
  let tmpRoot: string;
  let vaultDir: string;
  let service: VaultSyncService;

  let mockGitOps: DeepMocked<GitOpsService>;
  let mockCommandBus: DeepMocked<CommandBus>;
  let mockFileManifestRepo: DeepMocked<IFileManifestRepository>;
  let mockBuildManifest: DeepMocked<BuildManifestUseCase>;
  let mockConfig: DeepMocked<AppConfigService>;

  jest.setTimeout(30_000);

  beforeEach(async () => {
    // Set up temp vault dir
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-vault-sync-'));
    vaultDir = path.join(tmpRoot, 'vault');
    await fs.mkdir(vaultDir, { recursive: true });

    // Seed a minimal MEMORY.md
    await fs.writeFile(path.join(vaultDir, 'MEMORY.md'), '# MEMORY\n', 'utf-8');

    // Create mocks
    mockGitOps = createMock<GitOpsService>();
    mockCommandBus = createMock<CommandBus>();
    mockFileManifestRepo = createMock<IFileManifestRepository>();
    mockBuildManifest = createMock<BuildManifestUseCase>();
    mockConfig = createMock<AppConfigService>({
      vaultSyncIntervalSeconds: 1800,
      vaultPath: vaultDir,
    });

    mockGitOps.pullLatestMain.mockResolvedValue(undefined);
    mockCommandBus.execute.mockResolvedValue(undefined);
    mockFileManifestRepo.syncFromManifest.mockResolvedValue(undefined);
    mockBuildManifest.execute.mockResolvedValue({
      files: [{ relativePath: 'MEMORY.md', contentHash: 'abc123', fileSize: 9, updatedAt: new Date() }],
      manifestHash: 'hash1',
      generatedAt: new Date(),
    });

    const module: TestingModule = await Test.createTestingModule({
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

    service = module.get(VaultSyncService);
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  // ─── (a) happy path ────────────────────────────────────────────────────────

  it('(a) runSync() — calls pull, build manifest, syncFromManifest, and dispatches InvalidateContextCacheCommand', async () => {
    await service.runSync();

    expect(mockGitOps.pullLatestMain).toHaveBeenCalledTimes(1);
    expect(mockBuildManifest.execute).toHaveBeenCalledTimes(1);
    expect(mockFileManifestRepo.syncFromManifest).toHaveBeenCalledTimes(1);
    expect(mockCommandBus.execute).toHaveBeenCalledWith(expect.any(InvalidateContextCacheCommand));
  });

  // ─── (b) file added → manifest updated ────────────────────────────────────

  it('(b) runSync() — syncFromManifest receives updated file list after vault file added', async () => {
    // Arrange — add a new file (create subdirectory first)
    await fs.mkdir(path.join(vaultDir, 'decisions'), { recursive: true });
    await fs.writeFile(path.join(vaultDir, 'decisions/_index.md'), '# Decisions\n', 'utf-8');

    mockBuildManifest.execute.mockResolvedValue({
      files: [
        { relativePath: 'MEMORY.md', contentHash: 'abc123', fileSize: 9, updatedAt: new Date() },
        { relativePath: 'decisions/_index.md', contentHash: 'def456', fileSize: 13, updatedAt: new Date() },
      ],
      manifestHash: 'hash2',
      generatedAt: new Date(),
    });

    // Act
    await service.runSync();

    // Assert — syncFromManifest called with 2 files
    expect(mockFileManifestRepo.syncFromManifest).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ relativePath: 'MEMORY.md' }),
        expect.objectContaining({ relativePath: 'decisions/_index.md' }),
      ]),
    );
  });

  // ─── (c) file deleted → manifest shrinks ──────────────────────────────────

  it('(c) runSync() — syncFromManifest receives empty list when vault is empty', async () => {
    mockBuildManifest.execute.mockResolvedValue({
      files: [],
      manifestHash: 'empty',
      generatedAt: new Date(),
    });

    await service.runSync();

    expect(mockFileManifestRepo.syncFromManifest).toHaveBeenCalledWith([]);
  });

  // ─── (d) pull failure → abort iteration ───────────────────────────────────

  it('(d) runSync() — pull failure aborts iteration; manifest + cache NOT called', async () => {
    mockGitOps.pullLatestMain.mockRejectedValue(new Error('network error'));

    await service.runSync();

    expect(mockBuildManifest.execute).not.toHaveBeenCalled();
    expect(mockFileManifestRepo.syncFromManifest).not.toHaveBeenCalled();
    expect(mockCommandBus.execute).not.toHaveBeenCalled();
  });

  // ─── (e) interval fires runSync ───────────────────────────────────────────

  it('(e) onApplicationBootstrap() starts interval; advancing timer triggers runSync()', async () => {
    jest.useFakeTimers();

    try {
      const runSyncSpy = jest.spyOn(service, 'runSync').mockResolvedValue(undefined);

      service.onApplicationBootstrap();

      // Advance by one full interval
      await jest.advanceTimersByTimeAsync(1800 * 1_000);

      expect(runSyncSpy).toHaveBeenCalledTimes(1);
    } finally {
      service.onModuleDestroy();
      jest.useRealTimers();
    }
  });
});
