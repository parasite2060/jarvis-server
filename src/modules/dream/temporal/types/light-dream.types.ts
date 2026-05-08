/**
 * Activity I/O wire types for the light-dream pipeline (Story 13.10).
 *
 * Imported by:
 *   - The sandboxed `light-dream.workflow.ts` (type-only — sandbox-safe per
 *     `design/temporal-workflows.md §6.5`).
 *   - The non-sandboxed `light-dream.activities.ts` (compile-time only; the
 *     `@TemporalActivity` decorator threads them at runtime).
 *
 * # Q8 binding — snake_case keys
 *   Wire types use snake_case property names matching Python
 *   `app/activities/light/_models.py` field-for-field. This preserves
 *   byte-equivalence at the Temporal payload boundary (MC3 + MC5).
 *
 * # No imports
 *   This file MUST NOT import from `@nestjs/...`, `class-validator`, or
 *   anything that emits decorators / runtime code. Type-only declarations
 *   only — workflow sandbox safety per design/temporal-workflows.md §6.5.
 */

import type { SessionLogEntry } from '../../agents/schemas/extraction-summary.schema';
import type { FileAction } from '../../agents/schemas/record-result.schema';

/**
 * Workflow entry payload (signaled to coordinator via `submit_light`).
 * `session_id` is the Claude session UUID; `transcript_id` is the DB row PK.
 */
export interface LightDreamPayload {
  session_id: string;
  transcript_id: number;
}

/**
 * Workflow result returned to the coordinator.
 * `pr_url` is `null` when no daily-log changes were committed (short-session
 * skip OR record soft-fail).
 */
export interface LightDreamResult {
  dream_id: number;
  pr_url: string | null;
}

// ---------------------------------------------------------------------------
// loadTranscript
// ---------------------------------------------------------------------------

export interface LoadTranscriptInput {
  session_id: string;
  transcript_id: number;
}

export interface LoadTranscriptResult {
  dream_id: number;
  parsed_text: string;
  project: string | null;
  token_count: number | null;
  // ISO-8601 timestamp when the transcript row was created. Used by
  // `_deriveSessionStart` in the workflow to compute `HH:MM`.
  created_at_iso: string | null;
  segment_end_line: number;
  is_continuation: boolean;
}

// ---------------------------------------------------------------------------
// runExtraction
// ---------------------------------------------------------------------------

export interface ExtractionInput {
  dream_id: number;
  session_id: string;
  parsed_text: string;
  project: string | null;
  token_count: number | null;
  /** Optional vault-relative path to a copy of the transcript for the agent. */
  transcript_file: string | null;
}

export interface ExtractionAgentOutput {
  summary: string;
  no_extract: boolean;
  // Snake_case JSONB-equivalent — overwritten by deterministic
  // post-run assembly from deps.session_* collections.
  session_log_json: SessionLogEntry;
}

// ---------------------------------------------------------------------------
// persistSessionLog
// ---------------------------------------------------------------------------

export interface PersistSessionLogInput {
  dream_id: number;
  session_log_json: SessionLogEntry;
}

// ---------------------------------------------------------------------------
// runRecord
// ---------------------------------------------------------------------------

export interface RecordInput {
  dream_id: number;
  session_id: string;
  session_log_json: SessionLogEntry;
  source_date_iso: string; // YYYY-MM-DD
  session_start_iso: string; // HH:MM (24-hour UTC) or '00:00'
  summary: string;
  is_continuation: boolean;
}

export interface RecordWriteTriple {
  path: string;
  content: string;
  action: 'create' | 'append' | 'update' | 'skip';
}

export interface RecordAgentOutput {
  /**
   * Q12 = (c) RECOMMENDED — RESOLVED 2026-05-08: the writeFile tool collects
   * `(path, content, action)` triples; commitAndPr writes them on the new
   * branch. This deviates from Python (which writes during agent execution)
   * to fix Python's working-tree-fragility bug. Observable behaviour
   * identical; internal mechanism cleaner.
   */
  session_log_writes: RecordWriteTriple[];
  files_modified: string[];
  files: FileAction[];
  summary: string;
}

// ---------------------------------------------------------------------------
// updateTranscriptPosition
// ---------------------------------------------------------------------------

export interface UpdatePositionInput {
  transcript_id: number;
  segment_end_line: number;
}

// ---------------------------------------------------------------------------
// invalidateContextCache
// ---------------------------------------------------------------------------

export interface InvalidateCacheInput {
  dream_id: number;
}

// ---------------------------------------------------------------------------
// commitAndPr
// ---------------------------------------------------------------------------

export interface CommitAndPRInput {
  dream_id: number;
  session_id: string;
  source_date_iso: string;
  summary: string;
  files_modified: string[];
  extraction_summary: string;
  // The (path, content, action) triples produced by the record agent's
  // writeFile / updateReinforcement / flagContradiction tools.
  session_log_writes: RecordWriteTriple[];
}

export interface CommitAndPRResult {
  git_branch: string;
  git_pr_url: string | null;
  /**
   * `'created'` when a new PR was opened in this run.
   * `'existing'` when the activity is a Temporal retry and the PR was
   * already opened on the previous attempt (idempotency on retry).
   * `'no_changes'` when there were no files to commit (defensive).
   */
  git_pr_status: 'created' | 'existing' | 'no_changes';
}

// ---------------------------------------------------------------------------
// markDreamOutcome (Q13 — TS-only enhancement)
// ---------------------------------------------------------------------------

export interface MarkDreamOutcomeInput {
  dream_id: number;
  outcome: 'success' | 'partial' | 'failed';
}
