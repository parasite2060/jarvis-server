import { Inject, Injectable, Logger } from '@nestjs/common';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { DREAM_REPOSITORY, IDreamRepository } from 'src/shared/domain/repositories/dream.repository.interface';
import type { MarkDeepDreamOutcomeInput } from '../../workflows/deep-dream.workflow';

@Injectable()
export class MarkDeepDreamOutcomeActivity {
  private readonly logger = new Logger(MarkDeepDreamOutcomeActivity.name);

  constructor(@Inject(DREAM_REPOSITORY) private readonly dreamRepo: IDreamRepository) {}

  @TemporalActivity('deep.mark_dream_outcome')
  async markDeepDreamOutcome(inp: MarkDeepDreamOutcomeInput): Promise<void> {
    await this.dreamRepo.updateDreamOutcome(inp.dream_id, inp.outcome, 'completed');
    this.logger.log({
      message: 'deep dream outcome marked',
      event: 'deepDream.markDeepDreamOutcome.completed',
      dreamId: inp.dream_id,
      outcome: inp.outcome,
    });
  }
}
