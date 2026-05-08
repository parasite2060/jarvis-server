/**
 * Activity I/O wire types for the weekly-review pipeline (Story 13.12).
 *
 * Imported by:
 *   - The sandboxed `weekly-review.workflow.ts` (type-only — sandbox-safe per
 *     `design/temporal-workflows.md §6.5`).
 *   - The non-sandboxed `weekly-review.activities.ts` (compile-time only; the
 *     `@TemporalActivity` decorator threads them at runtime).
 *
 * # Q8 binding (RESOLVED 2026-05-08, inherited from 13.10): snake_case keys
 *   Wire types use snake_case property names matching Python
 *   `app/activities/weekly/_models.py` field-for-field. This preserves
 *   byte-equivalence at the Temporal payload boundary (MC3 + MC5).
 *
 * # No imports
 *   This file MUST NOT import from `@nestjs/...`, `class-validator`, or
 *   anything that emits decorators / runtime code. Type-only declarations
 *   only — workflow sandbox safety per design/temporal-workflows.md §6.5.
 */

// ---------------------------------------------------------------------------
// WeeklyReviewPayload / WeeklyReviewResult (workflow boundary)
// ---------------------------------------------------------------------------

export interface WeeklyReviewPayload {
  /** ISO date YYYY-MM-DD — Monday of the review week (drives child workflow ID). */
  week_start: string;
  /** 'auto' (Temporal Schedule) | 'manual' (POST /dream). Default 'auto'. */
  trigger?: string;
}

/**
 * Workflow result. Mirrors Python `_models.WeeklyReviewResult`.
 * - `'completed'`: full pipeline succeeded.
 * - `'partial'`: pipeline ran but at least one optional step soft-failed.
 *   (Reserved for future use; current pipeline has no soft-fail branches.)
 * - `'skipped'`: agent emitted empty `review_content` — no PR created.
 */
export interface WeeklyReviewResult {
  dream_id: number;
  /** TS-only enhancement (Q8) — Python omits this field. */
  status: 'completed' | 'partial' | 'skipped';
  pr_url?: string | null;
}

// ---------------------------------------------------------------------------
// gather_dailys
// ---------------------------------------------------------------------------

export interface GatherDailysResult {
  dream_id: number;
  /** ISO date passed through verbatim. */
  week_start: string;
  /** Map of `YYYY-MM-DD` → daily-log content. Empty entries omitted. */
  daily_logs: Record<string, string>;
}

// ---------------------------------------------------------------------------
// gather_indexes
// ---------------------------------------------------------------------------

export interface GatherIndexesInput {
  dream_id: number;
  week_start: string;
}

export interface GatherIndexesResult {
  /** Map of folder name → `{folder}/_index.md` body. Missing folders omitted. */
  vault_indexes: Record<string, string>;
  /** Body of `_guide.md` (empty string when missing). */
  vault_guide: string;
}

// ---------------------------------------------------------------------------
// run_weekly_review_agent
// ---------------------------------------------------------------------------

export interface AgentInput {
  dream_id: number;
  week_start: string;
  daily_logs: Record<string, string>;
  vault_indexes: Record<string, string>;
  vault_guide: string;
}

export interface AgentResult {
  review_content: string;
  week_themes: string[];
  stale_action_items: string[];
  /** Free-form string-keyed string map. */
  project_updates: Record<string, string>;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  tool_calls: number | null;
}

// ---------------------------------------------------------------------------
// write_review_file
// ---------------------------------------------------------------------------

export interface WriteReviewInput {
  dream_id: number;
  week_start: string;
  review_content: string;
}

/**
 * Triple-collection per Q3 deviation (inherited 13.10 Q12 / 13.11 Q3):
 * the activity does NOT write to disk. It returns the `(path, content,
 * action)` triple in `vault_writes` for `commitAndPr` to apply on the new
 * branch via `gitOps.writeFiles(...)`. `files_modified` mirrors Python's
 * `[{path, action: 'create'}]` (used in PR body).
 */
export interface WriteReviewResult {
  /** Mirrors Python `WriteReviewResult.review_path` (e.g., `reviews/2026-W19.md`). */
  review_path: string;
  files_modified: Array<{ path: string; action: string }>;
  /** Q3 deviation: triple-collection passed to commitAndPr. */
  vault_writes: Array<{ path: string; content: string; action: 'create' | 'update' }>;
}

// ---------------------------------------------------------------------------
// commit_and_pr
// ---------------------------------------------------------------------------

export interface WeeklyCommitAndPRInput {
  dream_id: number;
  /** `YYYY-Www` form (e.g., `2026-W19`) — drives branch + PR title. */
  week_iso: string;
  files_modified: Array<{ path: string; action: string }>;
  /** Q3 deviation: write triples produced by `writeReviewFile`. */
  vault_writes: Array<{ path: string; content: string; action: 'create' | 'update' }>;
}

export interface CommitAndPRResult {
  git_branch: string;
  /** Empty string when no PR was produced. */
  git_pr_url: string;
  /** 'created' | 'existing' | 'no_files' | 'merged'. */
  git_pr_status: string;
}

// ---------------------------------------------------------------------------
// invalidate_cache (TS-only enhancement, Q3)
// ---------------------------------------------------------------------------

export interface InvalidateCacheInput {
  dream_id: number;
}

// ---------------------------------------------------------------------------
// mark_dream_outcome (TS-only enhancement, Q8)
// ---------------------------------------------------------------------------

export interface MarkWeeklyReviewOutcomeInput {
  dream_id: number;
  outcome: 'completed' | 'partial' | 'skipped';
}
