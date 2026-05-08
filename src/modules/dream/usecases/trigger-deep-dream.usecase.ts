/**
 * TriggerDeepDreamUseCase — placeholder body (Story 13.10.5 / Q1).
 *
 * Module-map §1 line 107 prescribes this use case. Story 13.14 wires the
 * functional body (POST /dream + Temporal Schedule entry).
 */
import { Injectable, Logger } from '@nestjs/common';
import { TemporalClientService } from 'src/shared/temporal/temporal-client.service';

export interface TriggerDeepDreamInput {
  /** ISO YYYY-MM-DD; drives child workflow ID. */
  targetDate: string;
  /** 'auto' (Schedule) | 'manual' (POST /dream). */
  trigger?: string;
}

@Injectable()
export class TriggerDeepDreamUseCase {
  private readonly logger = new Logger(TriggerDeepDreamUseCase.name);

  constructor(private readonly temporal: TemporalClientService) {}

  async execute(input: TriggerDeepDreamInput): Promise<void> {
    this.logger.log({
      message: 'dream.triggerDeep.dispatch',
      event: 'dream.triggerDeep.dispatch',
      targetDate: input.targetDate,
      trigger: input.trigger ?? 'manual',
    });
    await this.temporal.signalCoordinator('deep', {
      target_date: input.targetDate,
      trigger: input.trigger ?? 'manual',
    });
  }
}
