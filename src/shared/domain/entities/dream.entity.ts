/**
 * Dream entity (Story 13.2 / Task 3).
 *
 * POTO mirror of `jarvis.dreams` (Python `Dream` in
 * `components/jarvis-server/app/models/tables.py`). `outcome` is plain `string`
 * — Nuance 3 resolved 2026-05-07 by team-lead: `tables.py` uses `String(30)`;
 * the `DREAM_OUTCOMES` constants tuple is introduced by Story 13.10 (first
 * consumer that SETS the value).
 */
export class Dream {
  id!: number;
  type!: string;
  trigger!: string;
  status: string = 'queued';
  outcome?: string | null;
  transcriptId?: number | null;
  inputSummary?: string | null;
  outputRaw?: string | null;
  sessionLog?: Record<string, unknown> | null;
  filesModified?: Record<string, unknown> | null;
  gitBranch?: string | null;
  gitPrUrl?: string | null;
  gitPrStatus?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  toolCalls?: number | null;
  errorMessage?: string | null;
  durationMs?: number | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  createdAt!: Date;

  constructor(init?: Partial<Dream>) {
    Object.assign(this, init);
  }
}
