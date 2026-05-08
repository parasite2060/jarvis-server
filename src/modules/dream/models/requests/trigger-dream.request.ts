/**
 * TriggerDreamRequest — POST /dream body shape (Story 13.10.5 placeholder;
 * Story 13.14 fills validators).
 */
export class TriggerDreamRequest {
  /** 'light' | 'deep' | 'weekly' — Story 13.14 narrows + validates. */
  kind!: string;
  /** Optional payload pertinent to the kind (sessionId / targetDate / weekStart). */
  payload?: Record<string, unknown>;
}
