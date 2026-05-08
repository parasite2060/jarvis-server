import { Injectable, Logger } from '@nestjs/common';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { AppConfigService } from 'src/shared/config/config.service';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import type { GatherIndexesInput, GatherIndexesResult } from '../../workflows/weekly-review.workflow';
import { VAULT_INDEX_FOLDERS, safeReadVault } from './helpers';

@Injectable()
export class GatherIndexesActivity {
  private readonly logger = new Logger(GatherIndexesActivity.name);

  constructor(private readonly config: AppConfigService) {}

  @TemporalActivity('weekly.gather_indexes')
  async gatherIndexes(inp: GatherIndexesInput): Promise<GatherIndexesResult> {
    try {
      const vaultIndexes: Record<string, string> = {};
      for (const folder of VAULT_INDEX_FOLDERS) {
        const content = await safeReadVault(this.config.vaultPath, `${folder}/_index.md`);
        if (content !== null && content.length > 0) {
          vaultIndexes[folder] = content;
        }
      }
      const vaultGuide = (await safeReadVault(this.config.vaultPath, '_guide.md')) ?? '';

      this.logger.log({
        message: 'weekly review gather_indexes completed',
        event: 'weeklyReview.gatherIndexes.completed',
        dreamId: inp.dream_id,
        indexCount: Object.keys(vaultIndexes).length,
        guideLength: vaultGuide.length,
      });

      return { vault_indexes: vaultIndexes, vault_guide: vaultGuide };
    } catch (err) {
      throw new InternalException(ErrorCode.WEEKLY_REVIEW_GATHER_INDEXES_FAILED, `gatherIndexes failed: ${(err as Error).message}`);
    }
  }
}
