import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { CONVERSATION_REPOSITORY, IConversationRepository } from 'src/shared/domain/repositories/conversation.repository.interface';
import { SecretScrubberService } from 'src/shared/secret-redaction/secret-scrubber.service';
import { TemporalClientService } from 'src/shared/temporal/temporal-client.service';
import { IngestTranscriptRequest } from '../models/requests/ingest-transcript.request';
import { IngestTranscriptResponse } from '../models/responses/ingest-transcript.response';
import { ConversationIngestedEvent, ConversationIngestedPayload } from '../events/conversation-ingested.event';
import { countTokensApproximate, parseTranscript } from '../utils/transcript-parser.util';

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
    private readonly temporal: TemporalClientService,
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

    const parsedText = parseTranscript(scrubbed);
    const tokenCount = countTokensApproximate(parsedText);

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
      await this.temporal.signalCoordinator('light', {
        transcript_id: row.id,
        session_id: request.sessionId,
      });
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
}
