/**
 * VaultSyncService — Story 13.17.1
 *
 * Periodic background loop that mirrors Python `app/main.py::_vault_sync_loop`.
 * Fires every VAULT_SYNC_INTERVAL_SECONDS (default 1800 = 30 min). Sequence:
 *   1. git pull origin main (GitOpsService)
 *   2. Scan vault + build manifest (BuildManifestUseCase)
 *   3. Sync manifest to DB (IFileManifestRepository.syncFromManifest)
 *   4. Invalidate context cache (InvalidateContextCacheCommand via CommandBus)
 *
 * Every error is swallowed with a warn log — the loop continues. Shutdown is
 * clean via clearInterval on OnModuleDestroy.
 */
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { InvalidateContextCacheCommand } from '../context/commands/invalidate-context-cache.command';
import { FILE_MANIFEST_REPOSITORY, IFileManifestRepository } from 'src/shared/domain/repositories/file-manifest.repository.interface';
import { GitOpsService } from 'src/shared/git/git-ops.service';
import { AppConfigService } from 'src/shared/config/config.service';
import { BuildManifestUseCase } from './usecases/build-manifest.usecase';

@Injectable()
export class VaultSyncService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(VaultSyncService.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly gitOps: GitOpsService,
    private readonly buildManifest: BuildManifestUseCase,
    @Inject(FILE_MANIFEST_REPOSITORY)
    private readonly fileManifestRepo: IFileManifestRepository,
    private readonly commandBus: CommandBus,
    private readonly config: AppConfigService,
  ) {}

  onApplicationBootstrap(): void {
    const intervalMs = this.config.vaultSyncIntervalSeconds * 1_000;
    this.logger.log({
      message: 'vault periodic sync loop started',
      event: 'vault.periodicSync.started',
      intervalSeconds: this.config.vaultSyncIntervalSeconds,
    });
    this.intervalHandle = setInterval(() => void this.runSync(), intervalMs);
    // unref so the interval doesn't keep the process alive during tests
    this.intervalHandle.unref();
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.logger.log({ message: 'vault periodic sync loop stopped', event: 'vault.periodicSync.stopped' });
    }
  }

  async runSync(): Promise<void> {
    try {
      await this.gitOps.pullLatestMain();
    } catch (err) {
      this.logger.warn({
        message: 'vault periodic sync: pull failed',
        event: 'vault.periodicSync.pullFailed',
        errorClass: (err as Error)?.name ?? 'Error',
      });
      return;
    }

    let fileCount = 0;
    try {
      const result = await this.buildManifest.execute();
      fileCount = result.files.length;
      await this.fileManifestRepo.syncFromManifest(result.files);
    } catch (err) {
      this.logger.warn({
        message: 'vault periodic sync: manifest sync failed',
        event: 'vault.periodicSync.manifestFailed',
        errorClass: (err as Error)?.name ?? 'Error',
      });
    }

    try {
      await this.commandBus.execute(new InvalidateContextCacheCommand({ reason: 'periodic-vault-sync', timestamp: new Date() }));
    } catch (err) {
      this.logger.warn({
        message: 'vault periodic sync: cache invalidation failed',
        event: 'vault.periodicSync.cacheFailed',
        errorClass: (err as Error)?.name ?? 'Error',
      });
    }

    this.logger.log({ message: 'vault periodic sync completed', event: 'vault.periodicSync.completed', fileCount });
  }
}
