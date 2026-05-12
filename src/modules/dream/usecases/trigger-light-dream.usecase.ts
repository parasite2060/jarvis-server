/**
 * TriggerLightDreamUseCase — Story 13.22.
 *
 * Creates a `jarvis.dreams` record before signaling Temporal coordinator,
 * then returns the inserted ID so the controller can include `dreamId` in
 * the POST /dream response. Mirrors the deep-dream pattern.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DREAM_REPOSITORY, IDreamRepository } from 'src/shared/domain/repositories/dream.repository.interface';
import { TemporalClientService } from 'src/shared/temporal/temporal-client.service';

export interface TriggerLightDreamInput {
  sessionId: string;
  transcriptId: number;
  targetDate?: string;
  trigger?: string;
  sourceDateIso?: string | null;
}

@Injectable()
export class TriggerLightDreamUseCase {
  private readonly logger = new Logger(TriggerLightDreamUseCase.name);

  constructor(
    private readonly temporal: TemporalClientService,
    @Inject(DREAM_REPOSITORY) private readonly dreamRepo: IDreamRepository,
  ) {}

  async execute(input: TriggerLightDreamInput): Promise<{ dreamId: number }> {
    // Story 13.22 AC #1: create DB record before signaling
    const dream = await this.dreamRepo.createDream({
      type: 'light',
      status: 'queued',
      trigger: input.trigger,
      transcriptId: input.transcriptId,
    });

    this.logger.log({
      message: 'dream.triggerLight.dispatch',
      event: 'dream.triggerLight.dispatch',
      dreamId: dream.id,
      sessionId: input.sessionId,
      transcriptId: input.transcriptId,
    });

    await this.temporal.signalCoordinator('light', {
      session_id: input.sessionId,
      transcript_id: input.transcriptId,
      dream_id: dream.id,
    });

    return { dreamId: dream.id };
  }
}
