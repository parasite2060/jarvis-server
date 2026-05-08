/**
 * CronChangedEvent — config → dream cross-module fire-and-forget event
 * (Story 13.10.5 — scaffolded per module-map §5.2.7).
 *
 * Story 13.13 owns the dream-module handler (re-registers Temporal Schedules
 * on cron change). The event class is scaffolded here so module-map §1
 * conformance is achieved in 13.10.5; consumers wire in 13.13.
 *
 * Per module-map §5.2.7: payload shape is `{ kind, oldCron, newCron }`.
 */

export type CronKind = 'deepDream' | 'weeklyReview';

export class CronChangedEventPayload {
  constructor(
    public readonly kind: CronKind,
    public readonly oldCron: string,
    public readonly newCron: string,
  ) {}
}

export class CronChangedEvent {
  constructor(public readonly payload: CronChangedEventPayload) {}
}
