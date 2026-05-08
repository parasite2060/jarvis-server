/**
 * Activity I/O wire types for the deep-dream pipeline (Story 13.11).
 *
 * Imported by:
 *   - The sandboxed `deep-dream.workflow.ts` (type-only — sandbox-safe per
 *     `design/temporal-workflows.md §6.5`).
 *   - The non-sandboxed `deep-dream.activities.ts` (compile-time only; the
 *     `@TemporalActivity` decorator threads them at runtime).
 *
 * # Q8 binding (RESOLVED 2026-05-08): snake_case keys
 *   Wire types use snake_case property names matching Python
 *   `app/activities/deep/_models.py` field-for-field. This preserves
 *   byte-equivalence at the Temporal payload boundary (MC3 + MC5).
 *
 * # No imports
 *   This file MUST NOT import from `@nestjs/...`, `class-validator`, or
 *   anything that emits decorators / runtime code. Type-only declarations
 *   only — workflow sandbox safety per design/temporal-workflows.md §6.5.
 */

// ---------------------------------------------------------------------------
// DeepDreamPayload / DeepDreamResult (workflow boundary)
// ---------------------------------------------------------------------------

export interface DeepDreamPayload {
  /** ISO format YYYY-MM-DD (e.g., '2026-05-07'). Drives branch name + dream_id key. */
  target_date: string;
  /** 'auto' (Temporal Schedule) | 'manual' (POST /dream). Default 'auto'. */
  trigger?: string;
  /** Optional explicit source date override; defaults to `target_date`. */
  source_date_iso?: string | null;
}

/**
 * Workflow result. Mirrors Python `_models.DeepDreamResult`.
 * - `'completed'`: full pipeline succeeded.
 * - `'partial'`: pipeline ran but Health Fix could not converge (status='incomplete').
 * - `'skipped'`: empty inputs OR no Phase 1 candidates.
 */
export interface DeepDreamResult {
  dream_id: number;
  status: 'completed' | 'partial' | 'skipped';
  pr_url?: string | null;
  error_message?: string | null;
}

// ---------------------------------------------------------------------------
// gather_inputs
// ---------------------------------------------------------------------------

export interface GatherInputsResult {
  dream_id: number;
  /** MemU semantic memories list (raw dicts; opaque to TS — Phase 1 formats). */
  memu_memories: Array<Record<string, unknown>>;
  memory_md: string;
  daily_log: string;
  soul_md: string;
  /** Resolved target date (mirrors `payload.target_date` after parsing). */
  source_date_iso: string;
}

// ---------------------------------------------------------------------------
// phase1_light_sleep
// ---------------------------------------------------------------------------

export interface Phase1Input {
  dream_id: number;
  memu_memories: Array<Record<string, unknown>>;
  memory_md: string;
  daily_log: string;
  soul_md: string;
  source_date_iso: string;
}

export interface LightSleepResult {
  /** Serialized ScoredCandidate[] — opaque dict shape preserved for Python parity. */
  candidates_json: Array<Record<string, unknown>>;
  duplicates_removed: number;
  contradictions_found: number;
}

// ---------------------------------------------------------------------------
// score_candidates
// ---------------------------------------------------------------------------

export interface ScoringInput {
  dream_id: number;
  candidates_json: Array<Record<string, unknown>>;
}

export interface ScoredCandidatesResult {
  /** Each entry is `{...candidate, score: number}` — Python `score_candidates.py:20`. */
  scored: Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// phase2_rem_sleep
// ---------------------------------------------------------------------------

export interface Phase2Input {
  dream_id: number;
  source_date_iso: string;
  candidates_json: Array<Record<string, unknown>>;
  scored_json: Array<Record<string, unknown>>;
}

export interface REMSleepResult {
  /** Serialized REMSleepOutput dict; `null` means soft-fail per Python policy. */
  output_json: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// phase3_deep_sleep
// ---------------------------------------------------------------------------

export interface Phase3Input {
  dream_id: number;
  source_date_iso: string;
  memu_memories: Array<Record<string, unknown>>;
  memory_md: string;
  daily_log: string;
  soul_md: string;
  phase1_summary: string;
  phase2_summary: string;
}

export interface ConsolidationResult {
  /** Serialized ConsolidationOutput (after Q14 topics-drop applied) + Q3 vault_writes. */
  consolidation_json: Record<string, unknown>;
  /** Phase 3's full conversation, serialized for Health Fix `messageHistory`. */
  messages_json: Array<Record<string, unknown>>;
  usage_input_tokens: number | null;
  usage_output_tokens: number | null;
  usage_total_tokens: number | null;
  usage_tool_calls: number | null;
}

// ---------------------------------------------------------------------------
// health_check
// ---------------------------------------------------------------------------

export interface HealthCheckInput {
  dream_id: number;
  source_date_iso: string;
  knowledge_gap_names: string[];
}

export interface HealthReportResult {
  /** Serialized HealthReport dict. */
  report_json: Record<string, unknown>;
  total_issues: number;
}

// ---------------------------------------------------------------------------
// health_fix
// ---------------------------------------------------------------------------

export interface HealthFixInput {
  dream_id: number;
  source_date_iso: string;
  /** Serialized health_check report (the LATEST one before health_fix runs). */
  report_json: Record<string, unknown>;
  /** Serialized Phase 3 conversation, for `messageHistory` continuation. */
  consolidation_messages_json: Array<Record<string, unknown>>;
  /**
   * Knowledge gap names from Phase 2 — re-used across health-fix iterations
   * since each loop pass re-runs `runHealthChecks(vault, knowledge_gaps)`.
   */
  knowledge_gap_names: string[];
}

export interface HealthFixResult {
  status: 'clean' | 'fixed' | 'incomplete';
  /** Final HealthReport dict after the loop. */
  report_json: Record<string, unknown>;
  total_issues_remaining: number;
}

// ---------------------------------------------------------------------------
// write_files
// ---------------------------------------------------------------------------

export interface WriteFilesInput {
  dream_id: number;
  source_date_iso: string;
  consolidation_json: Record<string, unknown>;
}

export interface WriteFilesFileEntry {
  path: string;
  action: string; // 'create' | 'update' | 'rewrite'
}

export interface WriteFilesResult {
  files_modified: WriteFilesFileEntry[];
  /** Q3 deviation: triple-collection passed to commitAndPr. */
  vault_writes: Array<{ path: string; content: string; action: 'create' | 'update' }>;
}

// ---------------------------------------------------------------------------
// commit_and_pr
// ---------------------------------------------------------------------------

export interface DeepCommitAndPRInput {
  dream_id: number;
  target_date_iso: string;
  files_modified: WriteFilesFileEntry[];
  /** Q3 deviation: write triples produced by `writeFiles`. */
  vault_writes: Array<{ path: string; content: string; action: 'create' | 'update' }>;
  /** Subset of ConsolidationStats for the PR body (Python renders 3 of 5). */
  stats: Record<string, unknown>;
}

export interface CommitAndPRResult {
  git_branch: string;
  /** Empty string when no PR was produced (Python `commit_and_pr.py` returns `""`). */
  git_pr_url: string;
  /** 'created' | 'existing' | 'no_files' | 'merged'. */
  git_pr_status: string;
}

// ---------------------------------------------------------------------------
// align_memu
// ---------------------------------------------------------------------------

export interface AlignMemuInput {
  dream_id: number;
  memory_md: string;
  source_date_iso: string;
  /** `dream-{dream_id}` — the file-based idempotency key (Q8). */
  idempotency_key: string;
}

// ---------------------------------------------------------------------------
// invalidate_cache
// ---------------------------------------------------------------------------

export interface InvalidateCacheInput {
  dream_id: number;
}

// ---------------------------------------------------------------------------
// mark_dream_outcome (TS-only enhancement, mirrors Story 13.10's pattern)
// ---------------------------------------------------------------------------

export interface MarkDeepDreamOutcomeInput {
  dream_id: number;
  outcome: 'completed' | 'partial' | 'skipped';
}
