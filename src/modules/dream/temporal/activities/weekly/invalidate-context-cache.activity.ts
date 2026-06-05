import { Injectable, Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import { InvalidateContextCacheCommand } from 'src/modules/context/commands/invalidate-context-cache.command';
import type { InvalidateCacheInput } from '../../workflows/weekly-review.workflow';

@Injectable()
export class WeeklyInvalidateContextCacheActivity {
  private readonly logger = new Logger(WeeklyInvalidateContextCacheActivity.name);

  constructor(private readonly commandBus: CommandBus) {}

  @TemporalActivity('weekly.invalidate_cache')
  async invalidateContextCache(inp: InvalidateCacheInput): Promise<void> {
    try {
      await this.commandBus.execute(new InvalidateContextCacheCommand({ reason: 'weekly-review-completed', timestamp: new Date() }));
      this.logger.log({
        message: 'weekly review invalidate context cache dispatched',
        event: 'weeklyReview.invalidateContextCache.dispatched',
        dreamId: inp.dream_id,
      });
    } catch (err) {
      throw new InternalException(ErrorCode.WEEKLY_REVIEW_INVALIDATE_CACHE_FAILED, `invalidateContextCache failed: ${(err as Error).message}`);
    }
  }
}
