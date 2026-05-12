/**
 * TriggerWeeklyReviewUseCase — Story 13.22.
 *
 * Creates a `jarvis.dreams` record before signaling Temporal coordinator,
 * then returns the inserted ID so the controller can include `dreamId` in
 * the POST /dream response.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DREAM_REPOSITORY, IDreamRepository } from 'src/shared/domain/repositories/dream.repository.interface';
import { TemporalClientService } from 'src/shared/temporal/temporal-client.service';

export interface TriggerWeeklyReviewInput {
  /** ISO YYYY-MM-DD; Monday of the review week. */
  weekStart: string;
  /** 'auto' (Schedule) | 'manual' (POST /dream). */
  trigger?: string;
}

@Injectable()
export class TriggerWeeklyReviewUseCase {
  private readonly logger = new Logger(TriggerWeeklyReviewUseCase.name);

  constructor(
    private readonly temporal: TemporalClientService,
    @Inject(DREAM_REPOSITORY) private readonly dreamRepo: IDreamRepository,
  ) {}

  async execute(input: TriggerWeeklyReviewInput): Promise<{ dreamId: number }> {
    const trigger = input.trigger ?? 'manual';

    // Story 13.22 AC #2: create DB record before signaling
    const dream = await this.dreamRepo.createDream({
      type: 'weekly-review',
      status: 'queued',
      trigger,
      transcriptId: null,
    });

    this.logger.log({
      message: 'dream.triggerWeekly.dispatch',
      event: 'dream.triggerWeekly.dispatch',
      dreamId: dream.id,
      weekStart: input.weekStart,
      trigger,
    });

    await this.temporal.signalCoordinator('weekly', {
      week_start: input.weekStart,
      trigger,
      dream_id: dream.id,
    });

    return { dreamId: dream.id };
  }
}
