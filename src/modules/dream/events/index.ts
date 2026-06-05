import { DreamCompletedEvent } from './dream-completed.event';

/**
 * Events array — re-exported per app-design §7.4. No EventHandlers in this
 * module in MVP (consumers reserved for future).
 */
export const Events = [DreamCompletedEvent];

export { DreamCompletedEvent, DreamCompletedEventPayload, type DreamKind } from './dream-completed.event';
