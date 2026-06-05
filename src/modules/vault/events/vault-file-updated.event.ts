/**
 * Vault file-updated domain event — Story 13.6 / AC #8.
 *
 * Mirrors `jarvis-module-map.md §5.2.5`. In-process domain event published by
 * future Stories 13.10 (light dream record agent vault writes) and 13.11
 * (deep dream Phase 3 vault writes). No publishers OR subscribers in 13.6.
 *
 * `code` is the literal string `'VAULT_FILE_UPDATED'` per Q9 — no numeric
 * ErrorCode slot is allocated for in-process events (the boilerplate
 * `DomainEventsHandler` accepts string codes per Story 13.3 Q7 precedent).
 */
import { DomainEvent, IDomainEventMetadata } from 'src/shared/common/models/seedwork/domain-event';

export class VaultFileUpdatedPayload {
  relativePath!: string;
  newHash!: string;
  updatedAt!: Date;

  constructor(init?: Partial<VaultFileUpdatedPayload>) {
    Object.assign(this, init);
  }
}

export class VaultFileUpdatedEvent extends DomainEvent<VaultFileUpdatedPayload> {
  public readonly payload: VaultFileUpdatedPayload;

  constructor(payload: VaultFileUpdatedPayload, metadata?: IDomainEventMetadata) {
    super({
      id: payload.relativePath,
      refId: metadata?.refId,
      timestamp: metadata?.timestamp,
      actor: metadata?.actor,
      source: metadata?.source || { module: 'vault' },
    });
    this.payload = payload;
  }

  public get code(): string {
    return 'VAULT_FILE_UPDATED';
  }

  public key(): string {
    return this.id;
  }
}
