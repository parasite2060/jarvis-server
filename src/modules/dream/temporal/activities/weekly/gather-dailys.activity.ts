import { Injectable, Logger } from '@nestjs/common';
import { ApplicationFailure } from '@temporalio/common';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { AppConfigService } from 'src/shared/config/config.service';
import { Dream } from 'src/shared/domain/entities/dream.entity';
import { DreamSchema } from 'src/shared/postgres/schema/dream.schema';
import { DBConnections } from 'src/shared/postgres/utils/constaint';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import type { GatherDailysResult, WeeklyReviewPayload } from '../../workflows/weekly-review.workflow';
import { DAILY_LOG_WINDOW_DAYS, SIXTY_SECONDS_MS, safeReadVault } from './helpers';

@Injectable()
export class GatherDailysActivity {
  private readonly logger = new Logger(GatherDailysActivity.name);

  constructor(
    @InjectDataSource(DBConnections.INTERNAL) private readonly dataSource: DataSource,
    private readonly config: AppConfigService,
  ) {}

  @TemporalActivity('weekly.gather_dailys')
  async gatherDailys(payload: WeeklyReviewPayload): Promise<GatherDailysResult> {
    const weekStart = payload.week_start;
    const trigger = payload.trigger ?? 'auto';

    const dreamId = await this.dataSource.transaction(async (manager) => {
      const dreamRepo = manager.getRepository(DreamSchema);
      const sixtySecondsAgo = new Date(Date.now() - SIXTY_SECONDS_MS);
      const existing = await dreamRepo
        .createQueryBuilder('d')
        .where('d.type = :type', { type: 'weekly_review' })
        .andWhere('d.created_at >= :cutoff', { cutoff: sixtySecondsAgo })
        .orderBy('d.created_at', 'DESC')
        .limit(1)
        .getOne();
      if (existing !== null) {
        return existing.id;
      }
      const dream = dreamRepo.create({
        type: 'weekly_review',
        trigger,
        status: 'processing',
        startedAt: new Date(),
      } satisfies Partial<Dream>);
      const saved = await dreamRepo.save(dream);
      return saved.id;
    });

    const dailyLogs: Record<string, string> = {};
    const startDate = new Date(`${weekStart}T00:00:00Z`);
    if (Number.isNaN(startDate.getTime())) {
      throw new InternalException(ErrorCode.WEEKLY_REVIEW_GATHER_DAILYS_EMPTY_WEEK, `Invalid week_start ISO date: ${weekStart}`);
    }
    for (let i = 0; i < DAILY_LOG_WINDOW_DAYS; i++) {
      const d = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
      const iso = d.toISOString().slice(0, 10);
      const content = await safeReadVault(this.config.vaultPath, `dailys/${iso}.md`);
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
