/**
 * TriggerDeepDreamUseCase — POST /dream entry point.
 *
 * Module-map §1 line 107 prescribes this use case. Wires the functional body
 * (POST /dream + Temporal Schedule entry). Story 13.14 extends the signal
 * payload to include `source_date_iso` (MC3 frozen per Python `dream.py:40-47`).
 */
import { Injectable, Logger } from '@nestjs/common';
import { TemporalClientService } from 'src/shared/temporal/temporal-client.service';

export interface TriggerDeepDreamInput {
  /** ISO YYYY-MM-DD; drives child workflow ID. */
  targetDate: string;
  /** 'auto' (Schedule) | 'manual' (POST /dream) | 'manual-backfill'. */
  trigger?: string;
  /**
   * ISO YYYY-MM-DD if user provided source_date in body; null otherwise.
   * New in Story 13.14 (cross-story extension to 13.10.5 scaffold).
   * Maps to Python's `source_date_iso: source_date.isoformat() if source_date else None`.
   */
  sourceDateIso?: string | null;
}

@Injectable()
export class TriggerDeepDreamUseCase {
  private readonly logger = new Logger(TriggerDeepDreamUseCase.name);

  constructor(private readonly temporal: TemporalClientService) {}

  async execute(input: TriggerDeepDreamInput): Promise<void> {
    const trigger = input.trigger ?? 'manual';
    const sourceDateIso = input.sourceDateIso ?? null;
    this.logger.log({
      message: 'dream.triggerDeep.dispatch',
      event: 'dream.triggerDeep.dispatch',
      targetDate: input.targetDate,
      trigger,
      sourceDateIso,
    });
    await this.temporal.signalCoordinator('deep', {
      target_date: input.targetDate,
      trigger,
      source_date_iso: sourceDateIso,
    });
  }
}
