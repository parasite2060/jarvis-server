import { Inject, Injectable, Logger } from '@nestjs/common';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { DREAM_REPOSITORY, IDreamRepository } from 'src/shared/domain/repositories/dream.repository.interface';
import type { MarkDreamOutcomeInput } from '../../workflows/light-dream.workflow';

@Injectable()
export class MarkDreamOutcomeActivity {
  private readonly logger = new Logger(MarkDreamOutcomeActivity.name);

  constructor(@Inject(DREAM_REPOSITORY) private readonly dreamRepo: IDreamRepository) {}

  @TemporalActivity('light.mark_dream_outcome')
  async markDreamOutcome(inp: MarkDreamOutcomeInput): Promise<void> {
    await this.dreamRepo.updateDreamOutcome(inp.dream_id, inp.outcome, 'completed');
    this.logger.log({
      message: 'light dream outcome marked',
      event: 'lightDream.markDreamOutcome.completed',
      dreamId: inp.dream_id,
      outcome: inp.outcome,
    });
  }
}
