/**
 * DreamPhase entity (Story 13.2 / Task 3).
 *
 * POTO mirror of `jarvis.dream_phases` (Python `DreamPhase` in
 * `components/jarvis-server/app/models/tables.py`).
 */
export class DreamPhase {
  id!: number;
  dreamId!: number;
  phase!: string;
  status: string = 'processing';
  runPrompt?: string | null;
  outputJson?: Record<string, unknown> | null;
  conversationHistory?: unknown[] | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  toolCalls?: number | null;
  durationMs?: number | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  errorMessage?: string | null;
  createdAt!: Date;

  constructor(init?: Partial<DreamPhase>) {
    Object.assign(this, init);
  }
}
