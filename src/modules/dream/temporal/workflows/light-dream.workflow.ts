/**
 * lightDreamWorkflow — TS port of `app/workflows/light_dream_workflow.py` (Story 13.10).
 *
 * # SANDBOX-CLEAN — Temporal replays this code on recovery.
 *   This file imports ONLY from `@temporalio/workflow` AND type-only imports
 *   from `../types/light-dream.types` (deleted). NO NestJS, NO `fs`, NO `crypto`,
 *   NO `Date.now()`, NO `Math.random()`, NO `src/...` runtime imports.
 *   All non-deterministic operations go through the workflow runtime API.
 *
 * # MC3 wire frozen
 *   - Workflow type: `LightDream` (registered via explicit `Worker.create({ workflows })`).
 *   - Activity wire names: `light.<snake_case>` per Dev Notes §B.
 *   - Snake_case payload keys preserved verbatim.
 *
 * # Activity ordering (per AC #3)
 *   1. loadTranscript
 *   2. runExtraction
 *   3. (branch) no_extract → return early
 *   4. persistSessionLog
 *   5. (inline) deriveSourceDate + deriveSessionStart
 *   6. runRecord (with soft-fail wrap per AC #11)
 *   7. updateTranscriptPosition
 *   8. (branch) files_modified.length > 0 → commitAndPr + invalidateContextCache
 *   9. markDreamOutcome
 *   10. return { dream_id, pr_url }
 *
 * # Q10 RESOLVED: per-policy proxyActivities groups
 *   - quickActs   (timeout 30s, retries 3-5): load, persist, updatePosition, invalidate, markOutcome
 *   - extractionActs (timeout 10min, retries 2): runExtraction
 *   - recordActs   (timeout 5min, retries 2): runRecord
 *   - commitActs   (timeout 2min, retries 3): commitAndPr
 *
 * # Q13 RESOLVED: markDreamOutcome 8th activity
 *   Workflow itself can't update DB (sandbox); the dedicated activity does it.
 */
import { proxyActivities, log } from '@temporalio/workflow';
import type { SessionLogEntry } from '../../agents/extraction-summary.schema';
import type { FileAction } from '../../agents/record-result.schema';

// ---------------------------------------------------------------------------
// Activity I/O wire types (Q6 RESOLVED 2026-05-08 by TanNT — inlined here
// from former `temporal/types/light-dream.types.ts` which was deleted to
// match module-map §1).
//
// # Q8 binding — snake_case keys mirror Python `app/activities/light/_models.py`
//   field-for-field (MC3 + MC5 byte-equivalence).
// # Sandbox-safe: only `import type` references — fully erased at runtime.
// ---------------------------------------------------------------------------

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
 * `pr_url` is `null` when no daily-log changes were committed.
 */
export interface LightDreamResult {
  dream_id: number;
  pr_url: string | null;
}

export interface LoadTranscriptInput {
  session_id: string;
  transcript_id: number;
}

export interface LoadTranscriptResult {
  dream_id: number;
  parsed_text: string;
  project: string | null;
  token_count: number | null;
  /** ISO-8601 timestamp of transcript-row creation. */
  created_at_iso: string | null;
  segment_end_line: number;
  is_continuation: boolean;
}

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
  /** Snake_case JSONB-equivalent — overwritten by deterministic post-run assembly. */
  session_log_json: SessionLogEntry;
}

export interface PersistSessionLogInput {
  dream_id: number;
  session_log_json: SessionLogEntry;
}

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
  /** Q12 = (c) RESOLVED — triples collected by record agent's writeFile etc.; commitAndPr writes them on the new branch. */
  session_log_writes: RecordWriteTriple[];
  files_modified: string[];
  files: FileAction[];
  summary: string;
}

export interface UpdatePositionInput {
  transcript_id: number;
  segment_end_line: number;
}

export interface InvalidateCacheInput {
  dream_id: number;
}

export interface CommitAndPRInput {
  dream_id: number;
  session_id: string;
  source_date_iso: string;
  summary: string;
  files_modified: string[];
  extraction_summary: string;
  session_log_writes: RecordWriteTriple[];
}

export interface CommitAndPRResult {
  git_branch: string;
  git_pr_url: string | null;
  /**
   * `'created'` when a new PR was opened in this run.
   * `'existing'` when the activity is a Temporal retry and the PR was already opened.
   * `'no_changes'` when there were no files to commit (defensive).
   */
  git_pr_status: 'created' | 'existing' | 'no_changes';
}

/** Q13 — TS-only enhancement (Python doesn't update dream.outcome). */
export interface MarkDreamOutcomeInput {
  dream_id: number;
  outcome: 'success' | 'partial' | 'failed';
}

// ---------------------------------------------------------------------------
// Activity proxies — multiple policy groups per Q10.
//
// IMPORTANT: `proxyActivities<T>()` dispatches the activity by the proxy
// METHOD NAME (the key in T). To match the MC3-frozen wire names registered
// via `@TemporalActivity('light.load_transcript')` etc., the proxy interface
// uses snake_case keys quoted as string-literal identifiers. The TS-idiomatic
// camelCase symbols are aliased into local consts immediately after.
// ---------------------------------------------------------------------------

interface QuickActs {
  'light.load_transcript'(inp: LoadTranscriptInput): Promise<LoadTranscriptResult>;
  'light.persist_session_log'(inp: PersistSessionLogInput): Promise<void>;
  'light.update_transcript_position'(inp: UpdatePositionInput): Promise<void>;
  'light.invalidate_cache'(inp: InvalidateCacheInput): Promise<void>;
  'light.mark_dream_outcome'(inp: MarkDreamOutcomeInput): Promise<void>;
}

const quickProxy = proxyActivities<QuickActs>({
  startToCloseTimeout: '30s',
  retry: {
    initialInterval: '1s',
    backoffCoefficient: 2,
    maximumInterval: '30s',
    maximumAttempts: 5,
  },
});

interface ExtractionActs {
  'light.run_extraction'(inp: ExtractionInput): Promise<ExtractionAgentOutput>;
}

const extractionProxy = proxyActivities<ExtractionActs>({
  startToCloseTimeout: '10 minutes',
  retry: {
    initialInterval: '5s',
    backoffCoefficient: 2,
    maximumInterval: '60s',
    maximumAttempts: 2,
  },
});

interface RecordActs {
  'light.run_record'(inp: RecordInput): Promise<RecordAgentOutput>;
}

const recordProxy = proxyActivities<RecordActs>({
  startToCloseTimeout: '5 minutes',
  retry: {
    initialInterval: '5s',
    backoffCoefficient: 2,
    maximumInterval: '60s',
    maximumAttempts: 2,
  },
});

interface CommitActs {
  'light.commit_and_pr'(inp: CommitAndPRInput): Promise<CommitAndPRResult>;
}

const commitProxy = proxyActivities<CommitActs>({
  startToCloseTimeout: '2 minutes',
  retry: {
    initialInterval: '2s',
    backoffCoefficient: 2,
    maximumInterval: '30s',
    maximumAttempts: 3,
  },
});

// Local TS-idiomatic aliases — keep workflow body readable without leaking
// snake_case wire names below.
const acts = {
  loadTranscript: quickProxy['light.load_transcript'],
  runExtraction: extractionProxy['light.run_extraction'],
  persistSessionLog: quickProxy['light.persist_session_log'],
  runRecord: recordProxy['light.run_record'],
  updateTranscriptPosition: quickProxy['light.update_transcript_position'],
  invalidateContextCache: quickProxy['light.invalidate_cache'],
  commitAndPr: commitProxy['light.commit_and_pr'],
  markDreamOutcome: quickProxy['light.mark_dream_outcome'],
};

// ---------------------------------------------------------------------------
// Deterministic inline helpers (sandbox-safe — pure data manipulation).
// ---------------------------------------------------------------------------

/**
 * Derive `source_date` from `memories[]` — max `source_date` lex-string-sort.
 * Falls back to `nowIsoUtc[:10]` per Python `_derive_source_date` lines 191-200.
 */
export function deriveSourceDate(sessionLog: SessionLogEntry, nowIsoUtc: string): string {
  let max = '';
  for (const m of sessionLog.memories) {
    if (m.source_date > max) {
      max = m.source_date;
    }
  }
  if (max === '') {
    return nowIsoUtc.slice(0, 10);
  }
  return max;
}

/**
 * Derive `session_start` from `created_at_iso` — `[11:16]` HH:MM slice.
 * Returns `'00:00'` when the input is null per Python `_derive_session_start`.
 */
export function deriveSessionStart(createdAtIso: string | null): string {
  if (createdAtIso === null || createdAtIso === undefined || createdAtIso.length < 16) {
    return '00:00';
  }
  return createdAtIso.slice(11, 16);
}

// ---------------------------------------------------------------------------
// Workflow entry point.
// ---------------------------------------------------------------------------

export async function lightDreamWorkflow(payload: LightDreamPayload): Promise<LightDreamResult> {
  // Step 1: load transcript + create dream row.
  const loadResult = await acts.loadTranscript({
    session_id: payload.session_id,
    transcript_id: payload.transcript_id,
  });
  const dreamId = loadResult.dream_id;

  // Step 2: extraction agent.
  const extractionOutput = await acts.runExtraction({
    dream_id: dreamId,
    session_id: payload.session_id,
    parsed_text: loadResult.parsed_text,
    project: loadResult.project,
    token_count: loadResult.token_count,
    transcript_file: null,
  });

  // Step 3: short-session no_extract branch.
  if (extractionOutput.no_extract) {
    await acts.markDreamOutcome({ dream_id: dreamId, outcome: 'success' });
    return { dream_id: dreamId, pr_url: null };
  }

  // Step 4: persist session log JSONB.
  await acts.persistSessionLog({
    dream_id: dreamId,
    session_log_json: extractionOutput.session_log_json,
  });

  // Step 5: deterministic helpers (no activities).
  // `Date.now()` is REPLAY-SAFE inside workflow code: the SDK's
  // `overrideGlobals()` (`@temporalio/workflow/lib/global-overrides.js:43-47`)
  // monkey-patches `global.Date.now` to return the deterministic activator
  // time, so it stays constant for the duration of a Workflow Task and across
  // replays. Round 1/2 Finding 3 asked for `workflow.now()`, but that
  // function does NOT exist in `@temporalio/workflow@1.17.0` (only
  // `proxyActivities`, `condition`, `executeChild`, `workflowInfo`, `sleep`,
  // `log` are exposed). `Date.now()` IS the SDK's actual deterministic time
  // primitive in this version. Using it explicitly (not `new Date()`) avoids
  // the "no `new Date()`" lint forbidden by Story 13.9's pattern; the
  // resulting ms value flows through pure data manipulation
  // (`new Date(<ms-number>)` is a deterministic-input construction, not a
  // clock read).
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const sourceDateIso = deriveSourceDate(extractionOutput.session_log_json, nowIso);
  const sessionStartIso = deriveSessionStart(loadResult.created_at_iso);

  // Step 6: record agent (with soft-fail wrap per AC #11).
  let recordOutput: RecordAgentOutput;
  let softFailed = false;
  try {
    recordOutput = await acts.runRecord({
      dream_id: dreamId,
      session_id: payload.session_id,
      session_log_json: extractionOutput.session_log_json,
      source_date_iso: sourceDateIso,
      session_start_iso: sessionStartIso,
      summary: extractionOutput.summary,
      is_continuation: loadResult.is_continuation,
    });
  } catch (err) {
    log.warn('lightDream.record.softFailed', { dream_id: dreamId, error: (err as Error).message });
    recordOutput = {
      session_log_writes: [],
      files_modified: [],
      files: [],
      summary: '',
    };
    softFailed = true;
  }

  // Step 7: update transcript position (always — even on record-fail per Python).
  await acts.updateTranscriptPosition({
    transcript_id: payload.transcript_id,
    segment_end_line: loadResult.segment_end_line,
  });

  // Step 8: commit + PR + invalidate cache (only when record produced files).
  let prUrl: string | null = null;
  if (recordOutput.files_modified.length > 0) {
    const commitResult = await acts.commitAndPr({
      dream_id: dreamId,
      session_id: payload.session_id,
      source_date_iso: sourceDateIso,
      summary: extractionOutput.summary,
      files_modified: recordOutput.files_modified,
      extraction_summary: extractionOutput.summary,
      session_log_writes: recordOutput.session_log_writes,
    });
    prUrl = commitResult.git_pr_url;
    await acts.invalidateContextCache({ dream_id: dreamId });
  }

  // Step 9: outcome update (Q13 8th activity).
  const outcome: 'success' | 'partial' = softFailed ? 'partial' : 'success';
  await acts.markDreamOutcome({ dream_id: dreamId, outcome });
  if (softFailed) {
    log.warn('lightDream.workflow.softFailedReturn', { dream_id: dreamId, partial: true });
  }

  return { dream_id: dreamId, pr_url: prUrl };
}
