/**
 * TriggerLightDreamUseCase — placeholder body (Story 13.10.5 / Q1).
 *
 * Module-map §1 line 106 prescribes this use case. Story 13.14 (POST /dream
 * REST endpoint) AND/OR the Q2 `TriggerLightDreamCommand` handler may use it
 * as the in-process entry point that signals the Temporal coordinator. Here
 * we only scaffold the class so the module structure conforms to §1.
 */
import { Injectable, Logger } from '@nestjs/common';
import { TemporalClientService } from 'src/shared/temporal/temporal-client.service';

export interface TriggerLightDreamInput {
  sessionId: string;
  transcriptId: number;
}

@Injectable()
export class TriggerLightDreamUseCase {
  private readonly logger = new Logger(TriggerLightDreamUseCase.name);

  constructor(private readonly temporal: TemporalClientService) {}

  /**
   * Signals the Temporal coordinator with `submit_light` payload. Mirrors
   * the path Q2's `TriggerLightDreamHandler` takes — both are valid entry
   * points until Story 13.14 chooses the canonical caller.
   */
  async execute(input: TriggerLightDreamInput): Promise<void> {
    this.logger.log({
      message: 'dream.triggerLight.dispatch',
      event: 'dream.triggerLight.dispatch',
      sessionId: input.sessionId,
      transcriptId: input.transcriptId,
    });
    await this.temporal.signalCoordinator('light', {
      session_id: input.sessionId,
      transcript_id: input.transcriptId,
    });
  }
}
