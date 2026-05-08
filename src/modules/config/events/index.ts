import { CronChangedEvent } from './cron-changed.event';

/**
 * Events array — re-exported per app-design §7.4. No EventHandlers in this
 * module (CronChangedEvent is consumed by `dream` module's handler in
 * Story 13.13).
 */
export const Events = [CronChangedEvent];

export { CronChangedEvent, CronChangedEventPayload, type CronKind } from './cron-changed.event';
