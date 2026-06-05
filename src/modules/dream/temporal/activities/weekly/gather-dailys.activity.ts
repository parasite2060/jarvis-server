import { Injectable, Logger } from '@nestjs/common';
import { ApplicationFailure } from '@temporalio/common';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { AppConfigService } from 'src/shared/config/config.service';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import type { WeeklyReviewPayload } from '../../workflows/weekly-review.workflow';
import { DAILY_LOG_WINDOW_DAYS, safeReadVault } from './helpers';

@Injectable()
export class GatherDailysActivity {
  private readonly logger = new Logger(GatherDailysActivity.name);

  constructor(private readonly config: AppConfigService) {}

  @TemporalActivity('weekly.gather_dailys')
  async gatherDailys(payload: WeeklyReviewPayload): Promise<{ dream_id: number; week_start: string; daily_logs: Record<string, string> }> {
    // B-03 fix: use dream_id passed from coordinator via workflow payload,
    // instead of creating an internal dream (which caused DB ID mismatch).
    const dreamId = payload.dream_id;
    const weekStart = payload.week_start;

    const dailyLogs: Record<string, string> = {};
    const startDate = new Date(`${weekStart}T00:00:00Z`);
    if (Number.isNaN(startDate.getTime())) {
      throw new InternalException(ErrorCode.WEEKLY_REVIEW_GATHER_DAILYS_EMPTY_WEEK, `Invalid week_start ISO date: ${weekStart}`);
    }
    for (let i = 0; i < DAILY_LOG_WINDOW_DAYS; i++) {
      const d = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
      const iso = d.toISOString().slice(0, 10);
      const yearMonth = iso.slice(0, 7); // YYYY-MM
      // Try flat path first (dailys/YYYY-MM-DD.md), then subdirectory path
      let content = await safeReadVault(this.config.vaultPath, `dailys/${iso}.md`);
      if (content === null) {
        content = await safeReadVault(this.config.vaultPath, `dailys/${yearMonth}/${iso}.md`);
      }
      if (content !== null && content.length > 0) {
        dailyLogs[iso] = content;
      }
    }

    if (Object.keys(dailyLogs).length === 0) {
      this.logger.warn({
        message: 'weekly review gather_dailys empty week',
        event: 'weeklyReview.gatherDailys.emptyWeek',
        dreamId,
        weekStart,
      });
      throw ApplicationFailure.nonRetryable(`No daily logs found for week starting ${weekStart}`, 'WEEKLY_REVIEW_EMPTY_WEEK');
    }

    this.logger.log({
      message: 'weekly review gather_dailys completed',
      event: 'weeklyReview.gatherDailys.completed',
      dreamId,
      weekStart,
      dailyCount: Object.keys(dailyLogs).length,
    });

    return { dream_id: dreamId, week_start: weekStart, daily_logs: dailyLogs };
  }
}
