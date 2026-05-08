/**
 * TriggerWeeklyReviewUseCase — placeholder body (Story 13.10.5 / Q1).
 *
 * Module-map §1 line 108 prescribes this use case. Story 13.13 (Temporal
 * Schedules) wires the functional body — invoked via Schedule relay.
 */
import { Injectable, Logger } from '@nestjs/common';
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

  constructor(private readonly temporal: TemporalClientService) {}

  async execute(input: TriggerWeeklyReviewInput): Promise<void> {
    this.logger.log({
      message: 'dream.triggerWeekly.dispatch',
      event: 'dream.triggerWeekly.dispatch',
      weekStart: input.weekStart,
      trigger: input.trigger ?? 'manual',
    });
    await this.temporal.signalCoordinator('weekly', {
      week_start: input.weekStart,
      trigger: input.trigger ?? 'manual',
    });
  }
}
