import { Inject, Injectable, Logger } from '@nestjs/common';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { AppConfigService } from 'src/shared/config/config.service';
import { MEMU_API, IMemuApi } from 'src/shared/domain/apis/memu-api.interface';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import type { AlignMemuInput } from '../../workflows/deep-dream.workflow';
import { IDEMPOTENCY_LOG_PATH, extractMemoryEntries, safeReadVault, safeWriteVault } from './helpers';

@Injectable()
export class AlignMemuActivity {
  private readonly logger = new Logger(AlignMemuActivity.name);

  constructor(
    @Inject(MEMU_API) private readonly memuApi: IMemuApi,
    private readonly config: AppConfigService,
  ) {}

  @TemporalActivity('deep.align_memu')
  async alignMemu(inp: AlignMemuInput): Promise<void> {
    const vaultRoot = this.config.vaultPath;
    try {
      const existing = (await safeReadVault(vaultRoot, IDEMPOTENCY_LOG_PATH)) ?? '';
      if (existing.split('\n').includes(inp.idempotency_key)) {
        this.logger.log({
          message: 'deep dream align_memu skipped — idempotent',
          event: 'deepDream.alignMemu.skipped.idempotent',
          dreamId: inp.dream_id,
          idempotencyKey: inp.idempotency_key,
        });
        return;
      }

      const entries = extractMemoryEntries(inp.memory_md);
      let synced = 0;
      let errors = 0;
      for (const entry of entries) {
        const messages = [
          {
            role: 'user',
            content: `[${entry.type}] ${entry.content} (source: deep_dream, date: ${inp.source_date_iso}, type: consolidated_memory)`,
          },
        ];
        try {
          await this.memuApi.memorize(messages);
          synced += 1;
        } catch (err) {
          errors += 1;
          this.logger.warn({
            message: 'deep dream align_memu item failed',
            event: 'deepDream.alignMemu.itemFailed',
            dreamId: inp.dream_id,
            entryType: entry.type,
            error: (err as Error).message,
          });
        }
      }

      const newContent = (existing.endsWith('\n') ? existing : existing.length > 0 ? `${existing}\n` : '') + `${inp.idempotency_key}\n`;
      await safeWriteVault(vaultRoot, IDEMPOTENCY_LOG_PATH, newContent);

      this.logger.log({
        message: 'deep dream align_memu completed',
        event: 'deepDream.alignMemu.completed',
        dreamId: inp.dream_id,
        itemsSynced: synced,
        errors,
      });
    } catch (err) {
      throw new InternalException(ErrorCode.DEEP_DREAM_ALIGN_MEMU_FAILED, `alignMemu failed: ${(err as Error).message}`);
    }
  }
}
