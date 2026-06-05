import { DomainEvent, IDomainEventMetadata } from 'src/shared/common/models/seedwork/domain-event';
import { ErrorCode } from 'src/utils/error.code';

export class ConversationIngestedPayload {
  transcriptId!: number;
  sessionId!: string;
  source!: string;
  isContinuation!: boolean;
  tokenCount!: number;

  constructor(init?: Partial<ConversationIngestedPayload>) {
    Object.assign(this, init);
  }
}

/**
 * Fired AFTER a transcript row is persisted and the Temporal coordinator
 * signal succeeds (Story 13.3 / Q7). Consumers in 13.5 (context-cache
 * invalidation) and 13.10 (light-dream extraction) attach later.
 */
export class ConversationIngestedEvent extends DomainEvent<ConversationIngestedPayload> {
  public readonly payload: ConversationIngestedPayload;

  constructor(payload: ConversationIngestedPayload, metadata?: IDomainEventMetadata) {
    super({
      id: String(payload.transcriptId),
      refId: metadata?.refId,
      timestamp: metadata?.timestamp,
      actor: metadata?.actor,
      source: metadata?.source || { module: 'conversation' },
    });
    this.payload = payload;
  }

  public get code(): string {
    return String(ErrorCode.CONVERSATION_INGESTED);
  }

  public key(): string {
    return this.id;
  }
}
