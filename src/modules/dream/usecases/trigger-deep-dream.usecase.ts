/**
 * TriggerDeepDreamUseCase — Story 13.22.
 *
 * Creates a `jarvis.dreams` record before signaling Temporal coordinator,
 * then returns the inserted ID so the controller can include `dreamId` in
 * the POST /dream response. Mirrors the light-dream pattern.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DREAM_REPOSITORY, IDreamRepository } from 'src/shared/domain/repositories/dream.repository.interface';
import { TemporalClientService } from 'src/shared/temporal/temporal-client.service';

export interface TriggerDeepDreamInput {
  /** ISO YYYY-MM-DD; drives child workflow ID. */
  targetDate: string;
  /** 'auto' (Schedule) | 'manual' (POST /dream) | 'manual-backfill'. */
  trigger?: string;
  /**
   * ISO YYYY-MM-DD if user provided source_date in body; null otherwise.
   * Maps to Python's `source_date_iso: source_date.isoformat() if source_date else None`.
   */
  sourceDateIso?: string | null;
}

@Injectable()
export class TriggerDeepDreamUseCase {
  private readonly logger = new Logger(TriggerDeepDreamUseCase.name);

  constructor(
    private readonly temporal: TemporalClientService,
    @Inject(DREAM_REPOSITORY) private readonly dreamRepo: IDreamRepository,
  ) {}

  async execute(input: TriggerDeepDreamInput): Promise<{ dreamId: number }> {
    const trigger = input.trigger ?? 'manual';
    const sourceDateIso = input.sourceDateIso ?? null;

    // Story 13.22 AC #1 / #4: create DB record before signaling
    const dream = await this.dreamRepo.createDream({
      type: 'deep',
      status: 'queued',
      trigger,
      transcriptId: 0,
    });

    this.logger.log({
      message: 'dream.triggerDeep.dispatch',
      event: 'dream.triggerDeep.dispatch',
      dreamId: dream.id,
      targetDate: input.targetDate,
      trigger,
      sourceDateIso,
    });

    await this.temporal.signalCoordinator('deep', {
      target_date: input.targetDate,
      trigger,
      source_date_iso: sourceDateIso,
      dream_id: dream.id,
    });

    return { dreamId: dream.id };
  }
}
