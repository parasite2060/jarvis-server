import { Conversation } from '../entities/conversation.entity';

export const CONVERSATION_REPOSITORY = Symbol('CONVERSATION_REPOSITORY');

export interface IConversationRepository {
  insertTranscript(input: Partial<Conversation>): Promise<Conversation>;
  findBySessionId(sessionId: string): Promise<Conversation[]>;
  getLastProcessedLine(sessionId: string): Promise<number>;
  setLastProcessedLine(sessionId: string, line: number): Promise<void>;
  findRecentBySession(sessionId: string, withinMs: number): Promise<Conversation[]>;
  /** Story 13.3 / Q1.a — push the `source` predicate to SQL (Python conversations.py:55). */
  findRecentBySessionAndSource(sessionId: string, source: string, withinMs: number): Promise<Conversation[]>;
  /** Story 13.3 / Q1.b — chain detection (Python conversations.py:74-78). */
  countBySessionId(sessionId: string): Promise<number>;
  /** Story 13.3 / Q1.c — narrow status update after Temporal signal (Python conversations.py:120). */
  setStatus(transcriptId: number, status: string): Promise<void>;
  /**
   * Story 13.10 / Q6 (RESOLVED 2026-05-08) — atomic update of `status`
   * AND `last_processed_line` in a single round-trip. Called from the
   * `updateTranscriptPosition` light-dream activity. Mirrors Python
   * `app/activities/light/update_transcript_position.py:9-22` semantics:
   *   - `status` always set (typically 'processed').
   *   - `lastProcessedLine` set ONLY when provided AND > 0.
   * Idempotent on Temporal retry.
   */
  updatePosition(transcriptId: number, status: string, lastProcessedLine?: number): Promise<void>;
}
