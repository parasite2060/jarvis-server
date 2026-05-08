import { CronChangedEventsHandler } from './cron-changed.handler';

/**
 * EventHandlers array — re-exported per app-design §7.4. Story 13.13 added
 * the cross-module `CronChangedEvent` consumer.
 */
export const EventHandlers = [CronChangedEventsHandler];

export { CronChangedEventsHandler };
