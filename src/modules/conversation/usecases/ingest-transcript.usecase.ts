import { Inject, Injectable, Logger } from '@nestjs/common';
import { CommandBus, EventBus } from '@nestjs/cqrs';
import { CONVERSATION_REPOSITORY, IConversationRepository } from 'src/shared/domain/repositories/conversation.repository.interface';
import { SecretScrubberService } from 'src/shared/secret-redaction/secret-scrubber.service';
import { IngestTranscriptRequest } from '../models/requests/ingest-transcript.request';
import { IngestTranscriptResponse } from '../models/responses/ingest-transcript.response';
import { ConversationIngestedEvent, ConversationIngestedPayload } from '../events/conversation-ingested.event';
// Q2 RESOLVED 2026-05-08 by TanNT — module-map §1 wins over §A.4. The
// conversation module no longer injects TemporalClientService directly;
// it dispatches TriggerLightDreamCommand via CommandBus, and the dream
// module's handler (in src/modules/dream/commands/handlers/) calls the
// temporal client. Cross-business-module call goes through the formal
// Command path per architecture.md §1.4 principle 8.
import { TriggerLightDreamCommand } from 'src/modules/dream/commands/trigger-light-dream.command';

const DEDUP_WINDOW_MS = 60_000;

export type IngestTranscriptResult = {
  httpStatus: 200 | 202;
  body: IngestTranscriptResponse;
};

@Injectable()
export class IngestTranscriptUseCase {
  private readonly logger = new Logger(IngestTranscriptUseCase.name);

  constructor(
    @Inject(CONVERSATION_REPOSITORY)
    private readonly repository: IConversationRepository,
    private readonly scrubber: SecretScrubberService,
    private readonly commandBus: CommandBus,
    private readonly eventBus: EventBus,
  ) {}

  async execute(request: IngestTranscriptRequest): Promise<IngestTranscriptResult> {
    // Python conversations.py:52-58 — 60s dedup window over (sessionId, source).
    const recent = await this.repository.findRecentBySessionAndSource(request.sessionId, request.source, DEDUP_WINDOW_MS);
    const existing = recent[0];
    if (existing) {
      this.logger.log({
        message: 'duplicate transcript ingested within dedup window',
        event: 'conversation.ingest.duplicate',
        sessionId: request.sessionId,
        source: request.source,
        transcriptId: existing.id,
      });
      return { httpStatus: 200, body: new IngestTranscriptResponse(existing.id, true) };
    }

    // Python conversations.py:74-78 — chain detection.
    const chainCount = await this.repository.countBySessionId(request.sessionId);
    const isContinuation = chainCount > 0;

    // Python conversations.py:80-86 — secret scrub + redaction telemetry.
    const { scrubbed, redactionCounts } = this.scrubber.scrub(request.transcript);
    if (Object.keys(redactionCounts).length > 0) {
      this.logger.log({
        message: 'secret scrubber redactions emitted',
        event: 'secretScrubber.redactions.completed',
        sessionId: request.sessionId,
        countsByType: redactionCounts,
      });
    }

    const parsedText = this.parseTranscript(scrubbed);
    const tokenCount = this.countTokensApproximate(parsedText);

    // Python conversations.py:91-104 — insert with status='received'.
    const row = await this.repository.insertTranscript({
      sessionId: request.sessionId,
      source: request.source,
      rawContent: scrubbed,
      parsedText,
      tokenCount,
      status: 'received',
      isContinuation,
      segmentStartLine: request.segmentStartLine,
      segmentEndLine: request.segmentEndLine,
    });

    this.logger.log({
      message: 'transcript ingested',
      event: 'conversation.ingest.received',
      sessionId: request.sessionId,
      source: request.source,
      transcriptId: row.id,
      tokenCount,
      transcriptLength: scrubbed.length,
    });

    // Python conversations.py:115-132 — signal coordinator with explicit
    // try/catch (intentional exception to the "no try/catch in use cases"
    // rule). Redact-and-proceed: a failed signal must NOT cause the user-
    // facing 202 to fail; the coordinator workflow's signal-queue replay
    // (Story 13.8 design) covers retry on the activity side.
    try {
      // Q2 RESOLVED 2026-05-08 by TanNT — dispatch via CommandBus instead
      // of direct TemporalClientService.signalCoordinator. The dream
      // module's TriggerLightDreamHandler delegates to its
      // TriggerLightDreamUseCase, which signals the Temporal coordinator.
      // Net behavior identical to the pre-13.10.5 path.
      await this.commandBus.execute(
        new TriggerLightDreamCommand({
          sessionId: request.sessionId,
          transcriptId: row.id,
        }),
      );
      await this.repository.setStatus(row.id, 'queued');
      this.logger.log({
        message: 'transcript queued for light dream',
        event: 'conversation.ingest.queued',
        sessionId: request.sessionId,
        transcriptId: row.id,
      });
    } catch (err) {
      this.logger.error({
        message: 'temporal coordinator signal failed',
        event: 'conversation.ingest.temporalSignalFailed',
        sessionId: request.sessionId,
        transcriptId: row.id,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }

    this.eventBus.publish(
      new ConversationIngestedEvent(
        new ConversationIngestedPayload({
          transcriptId: row.id,
          sessionId: request.sessionId,
          source: request.source,
          isContinuation,
          tokenCount,
        }),
      ),
    );

    return { httpStatus: 202, body: new IngestTranscriptResponse(row.id, false) };
  }

  /**
   * Identity-stub transcript parser. Was `transcript-parser.util.ts`; inlined
   * here per Story 13.10.5 / Q10 RESOLVED 2026-05-08 by TanNT (module-map §1
   * does not list `conversation/utils/`).
   *
   * Story 13.10 ports the full Python parser into the light-dream extraction
   * agent path; this method only populates Postgres `parsed_text` with a
   * sane-but-not-precise value.
   */
  private parseTranscript(text: string): string {
    return text;
  }

  /**
   * Approximate token count — `Math.ceil(length / 4)`. Inlined per Q10.
   * NOT for production cost estimates.
   */
  private countTokensApproximate(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
