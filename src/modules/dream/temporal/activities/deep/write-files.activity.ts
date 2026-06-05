import { Inject, Injectable, Logger } from '@nestjs/common';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { AppConfigService } from 'src/shared/config/config.service';
import { FILE_MANIFEST_REPOSITORY, IFileManifestRepository } from 'src/shared/domain/repositories/file-manifest.repository.interface';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import type { VaultUpdates, VaultWriteTriple } from '../../../agents/consolidation-output.schema';
import type { WriteFilesInput, WriteFilesResult } from '../../workflows/deep-dream.workflow';
import { buildVaultFileWithFrontmatter, safeReadVault, safeWriteVault } from './helpers';

@Injectable()
export class WriteFilesActivity {
  private readonly logger = new Logger(WriteFilesActivity.name);

  constructor(
    @Inject(FILE_MANIFEST_REPOSITORY) private readonly manifestRepo: IFileManifestRepository,
    private readonly config: AppConfigService,
  ) {}

  @TemporalActivity('deep.write_files')
  async writeFiles(inp: WriteFilesInput): Promise<WriteFilesResult> {
    try {
      const consolidationRaw = inp.consolidation_json;
      const memoryMd = typeof consolidationRaw['memory_md'] === 'string' ? consolidationRaw['memory_md'] : '';
      if (memoryMd.trim() === '') {
        throw new InternalException(ErrorCode.DEEP_DREAM_WRITE_FILES_FAILED, 'consolidation memory_md is empty');
      }
      const dailySummary = typeof consolidationRaw['daily_summary'] === 'string' ? consolidationRaw['daily_summary'] : '';
      if (dailySummary.trim() === '') {
        throw new InternalException(ErrorCode.DEEP_DREAM_WRITE_FILES_FAILED, 'consolidation daily_summary is empty');
      }

      const filesModified: Array<{ path: string; action: string }> = [];
      const vaultWrites: VaultWriteTriple[] = [];

      const sourceDateIso = inp.source_date_iso;
      const currentMemory = (await safeReadVault(this.config.vaultPath, 'MEMORY.md')) ?? '';
      const backupRel = `topics/memory-backup-${sourceDateIso}.md`;
      await safeWriteVault(this.config.vaultPath, backupRel, currentMemory);
      filesModified.push({ path: 'MEMORY.md', action: 'rewrite' });
      filesModified.push({ path: backupRel, action: 'create' });

      vaultWrites.push({ path: 'MEMORY.md', content: memoryMd, action: 'update' });

      const vaultUpdatesRaw = (consolidationRaw['vault_updates'] as VaultUpdates | undefined) ?? null;
      if (vaultUpdatesRaw !== null) {
        const vaultUpdates: Omit<VaultUpdates, 'topics'> = {
          decisions: vaultUpdatesRaw.decisions ?? [],
          projects: vaultUpdatesRaw.projects ?? [],
          patterns: vaultUpdatesRaw.patterns ?? [],
          templates: vaultUpdatesRaw.templates ?? [],
          concepts: vaultUpdatesRaw.concepts ?? [],
          connections: vaultUpdatesRaw.connections ?? [],
          lessons: vaultUpdatesRaw.lessons ?? [],
        };
        for (const folder of Object.keys(vaultUpdates) as Array<keyof typeof vaultUpdates>) {
          const entries = vaultUpdates[folder];
          for (const entry of entries) {
            const relPath = `${folder}/${entry.filename}`;
            const body = entry.action === 'create' ? buildVaultFileWithFrontmatter(folder, entry, sourceDateIso) : entry.content;
            vaultWrites.push({ path: relPath, content: body, action: entry.action });
            filesModified.push({ path: relPath, action: entry.action });
          }
        }
      }

      try {
        for (const fm of filesModified) {
          await this.manifestRepo.upsertEntry({
            filePath: fm.path,
            contentHash: '',
            updatedAt: new Date(),
          });
        }
      } catch (err) {
        this.logger.warn({ message: 'manifest upsert failed', event: 'deepDream.writeFiles.manifestFailed', error: (err as Error).message });
      }

      this.logger.log({
        message: 'deep dream write_files completed',
        event: 'deepDream.writeFiles.completed',
        dreamId: inp.dream_id,
        filesModifiedCount: filesModified.length,
      });

      return { files_modified: filesModified, vault_writes: vaultWrites };
    } catch (err) {
      if (err instanceof InternalException) throw err;
      throw new InternalException(ErrorCode.DEEP_DREAM_WRITE_FILES_FAILED, `writeFiles failed: ${(err as Error).message}`);
    }
  }
}
