/**
 * DreamCompletedEvent — fire-and-forget event (Story 13.10.5 / Q3 RESOLVED).
 *
 * Per module-map §5.2.4: consumers are context (cache invalidation), vault
 * (manifest refresh), dream (metrics). In MVP the cache-invalidation path
 * uses the explicit CommandBus path (§5.2.2), and other consumers are
 * "reserved for future". This event class is structurally present per §1
 * for future use; no consumers wired in 13.10.5.
 */

export type DreamKind = 'light' | 'deep' | 'weeklyReview';

export class DreamCompletedEventPayload {
  constructor(
    public readonly dreamId: number,
    public readonly kind: DreamKind,
    public readonly outcome: 'completed' | 'partial' | 'skipped' | 'failed',
    public readonly prUrl: string | null,
    public readonly completedAt: Date,
  ) {}
}

export class DreamCompletedEvent {
  constructor(public readonly payload: DreamCompletedEventPayload) {}
}
