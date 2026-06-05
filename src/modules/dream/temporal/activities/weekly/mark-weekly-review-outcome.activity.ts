import { Inject, Injectable, Logger } from '@nestjs/common';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { DREAM_REPOSITORY, IDreamRepository } from 'src/shared/domain/repositories/dream.repository.interface';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import type { MarkWeeklyReviewOutcomeInput } from '../../workflows/weekly-review.workflow';

@Injectable()
export class MarkWeeklyReviewOutcomeActivity {
  private readonly logger = new Logger(MarkWeeklyReviewOutcomeActivity.name);

  constructor(@Inject(DREAM_REPOSITORY) private readonly dreamRepo: IDreamRepository) {}

  @TemporalActivity('weekly.mark_dream_outcome')
  async markWeeklyReviewOutcome(inp: MarkWeeklyReviewOutcomeInput): Promise<void> {
    try {
      await this.dreamRepo.updateDreamOutcome(inp.dream_id, inp.outcome, 'completed');
      this.logger.log({
        message: 'weekly review outcome marked',
        event: 'weeklyReview.markWeeklyReviewOutcome.completed',
        dreamId: inp.dream_id,
        outcome: inp.outcome,
      });
    } catch (err) {
      throw new InternalException(ErrorCode.WEEKLY_REVIEW_OUTCOME_UPDATE_FAILED, `markWeeklyReviewOutcome failed: ${(err as Error).message}`);
    }
  }
}
