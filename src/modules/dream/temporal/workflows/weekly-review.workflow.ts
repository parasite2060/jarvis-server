/**
 * weeklyReviewWorkflow — TS port of `app/workflows/weekly_review_workflow.py`
 * (Story 13.12).
 *
 * # SANDBOX-CLEAN — Temporal replays this code on recovery.
 *   This file imports ONLY from `@temporalio/workflow` AND type-only imports
 *   from `../types/weekly-review.types` AND a pure-data import from
 *   `./iso-week.ts`. NO NestJS, NO `fs`, NO `crypto`, NO `Math.random()`,
 *   NO `src/...` runtime imports.
 *
 *   Per the Story 13.10 Finding 3 reversal (verified against
 *   `@temporalio/workflow/lib/global-overrides.js:43-47`): `Date.now()` and
 *   `new Date()` are MONKEY-PATCHED inside the SDK to return the
 *   activator's deterministic time and ARE replay-safe in this version.
 *   This workflow doesn't use them — all clock reads stay in activities.
 *
 * # MC3 wire frozen
 *   - Workflow type: `WeeklyReview` (registered via aliased re-export in
 *     `workflows/index.ts` — Stories 13.10/13.11 actual landed pattern).
 *   - Activity wire names: `weekly.<snake_case>` (5 Python + 2 TS-only:
 *     `weekly.invalidate_cache` Q3, `weekly.mark_dream_outcome` Q8).
 *   - Snake_case payload keys preserved verbatim.
 *
 * # Q1 RESOLVED 2026-05-08: workflow ID format
 *   The coordinator dispatches with child workflow ID
 *   `weekly-${week_start_YYYY-MM-DD}` (date-keyed Monday) — see
 *   `coordinator.py:101`. Branch / file / PR title use ISO-week form
 *   `YYYY-Www` instead. Dual-format preserved.
 *
 * # Q3 RESOLVED 2026-05-08: invalidateContextCache + triple-collection
 *   Python's weekly pipeline does NOT invalidate the cache and writes
 *   directly to disk in writeReviewFile. The TS port adds
 *   invalidateContextCache for parity with light/deep dreams, AND adopts
 *   the (path, content, action) triple-collection pattern (writeReviewFile
 *   returns the triple; commitAndPr writes it on the new branch).
 *
 * # Q5 RESOLVED 2026-05-08: empty-week non-retryable
 *   `gatherDailys` raises `ApplicationFailure.nonRetryable(...)` if
 *   `daily_logs` is empty. Workflow propagates the failure (no try/catch
 *   here) — Temporal records it; Dream row stays at 'processing' (Python
 *   parity).
 *
 * # Activity ordering (per AC #3 — mirrors Python lines 52-138)
 *   1. gatherDailys
 *   2. gatherIndexes
 *   3. runWeeklyReviewAgent
 *   4. (skip-guard) empty review_content → mark completed + return
 *   5. inline weekIso() helper (sandbox-safe pure function)
 *   6. writeReviewFile (Q3 — collects triple, NO disk write)
 *   7. commitAndPr (Q3 — writes triples on new branch)
 *   8. invalidateContextCache (TS-only — Q3)
 *   9. markWeeklyReviewOutcome (TS-only — Q8)
 *   10. return WeeklyReviewResult
 *
 * # Proxy groups (3 by retry policy — Dev Notes §A)
 *   - quickProxy   (30s timeout, 3 retries): gatherDailys, gatherIndexes,
 *     writeReviewFile, invalidateContextCache, markWeeklyReviewOutcome.
 *   - agentProxy   (10min timeout, 2 retries): runWeeklyReviewAgent.
 *   - commitProxy  (2min timeout, 3 retries): commitAndPr.
 */
import { proxyActivities, log } from '@temporalio/workflow';
import { weekIso } from './iso-week';
import type {
  AgentInput,
  AgentResult,
  CommitAndPRResult,
  GatherDailysResult,
  GatherIndexesInput,
  GatherIndexesResult,
  InvalidateCacheInput,
  MarkWeeklyReviewOutcomeInput,
  WeeklyCommitAndPRInput,
  WeeklyReviewPayload,
  WeeklyReviewResult,
  WriteReviewInput,
  WriteReviewResult,
} from '../types/weekly-review.types';

// ---------------------------------------------------------------------------
// Activity proxies — three policy groups.
// ---------------------------------------------------------------------------

interface QuickActs {
  'weekly.gather_dailys'(inp: WeeklyReviewPayload): Promise<GatherDailysResult>;
  'weekly.gather_indexes'(inp: GatherIndexesInput): Promise<GatherIndexesResult>;
  'weekly.write_review_file'(inp: WriteReviewInput): Promise<WriteReviewResult>;
  'weekly.invalidate_cache'(inp: InvalidateCacheInput): Promise<void>;
  'weekly.mark_dream_outcome'(inp: MarkWeeklyReviewOutcomeInput): Promise<void>;
}

const quickProxy = proxyActivities<QuickActs>({
  startToCloseTimeout: '30 seconds',
  retry: {
    initialInterval: '1s',
    backoffCoefficient: 2,
    maximumInterval: '10s',
    maximumAttempts: 3,
  },
});

interface AgentActs {
  'weekly.run_weekly_review_agent'(inp: AgentInput): Promise<AgentResult>;
}

const agentProxy = proxyActivities<AgentActs>({
  startToCloseTimeout: '10 minutes',
  retry: {
    initialInterval: '5s',
    backoffCoefficient: 2,
    maximumInterval: '60s',
    maximumAttempts: 2,
  },
});

interface CommitActs {
  'weekly.commit_and_pr'(inp: WeeklyCommitAndPRInput): Promise<CommitAndPRResult>;
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

// Local TS-idiomatic camelCase aliases — keep workflow body readable.
const acts = {
  gatherDailys: quickProxy['weekly.gather_dailys'],
  gatherIndexes: quickProxy['weekly.gather_indexes'],
  writeReviewFile: quickProxy['weekly.write_review_file'],
  invalidateContextCache: quickProxy['weekly.invalidate_cache'],
  markWeeklyReviewOutcome: quickProxy['weekly.mark_dream_outcome'],
  runWeeklyReviewAgent: agentProxy['weekly.run_weekly_review_agent'],
  commitAndPr: commitProxy['weekly.commit_and_pr'],
};

// ---------------------------------------------------------------------------
// Workflow entry point.
// ---------------------------------------------------------------------------

export async function weeklyReviewWorkflow(payload: WeeklyReviewPayload): Promise<WeeklyReviewResult> {
  // Step 1: gatherDailys (creates Dream row, reads 7-day window). Q5 raises
  // ApplicationFailure.nonRetryable on empty week — propagated.
  const gather = await acts.gatherDailys(payload);
  const dreamId = gather.dream_id;

  // Step 2: gatherIndexes (pure read, idempotent).
  const indexes = await acts.gatherIndexes({ dream_id: dreamId, week_start: payload.week_start });

  // Step 3: runWeeklyReviewAgent (single LLM phase, writes dream_phases row).
  const agentResult = await acts.runWeeklyReviewAgent({
    dream_id: dreamId,
    week_start: payload.week_start,
    daily_logs: gather.daily_logs,
    vault_indexes: indexes.vault_indexes,
    vault_guide: indexes.vault_guide,
  });

  // Step 4: skip-guard — empty review_content → no PR, but still mark outcome
  // 'completed' (Python returns pr_url=null without writing).
  if (agentResult.review_content === '') {
    log.warn('weeklyReview.workflow.skipped.emptyReview', { dream_id: dreamId });
    await acts.markWeeklyReviewOutcome({ dream_id: dreamId, outcome: 'completed' });
    return { dream_id: dreamId, status: 'completed', pr_url: null };
  }

  // Step 5: deterministic week_iso derivation (sandbox-safe pure function).
  const weekIsoStr = weekIso(payload.week_start);

  // Step 6: writeReviewFile (Q3 — collects triple, NO disk write).
  const writeResult = await acts.writeReviewFile({
    dream_id: dreamId,
    week_start: payload.week_start,
    review_content: agentResult.review_content,
  });

  // Step 7: commitAndPr (Q3 — writes triples on new branch).
  const commit = await acts.commitAndPr({
    dream_id: dreamId,
    week_iso: weekIsoStr,
    files_modified: writeResult.files_modified,
    vault_writes: writeResult.vault_writes,
  });
  const prUrl = commit.git_pr_url.length > 0 ? commit.git_pr_url : null;

  // Step 8: invalidateContextCache (TS-only — Q3).
  await acts.invalidateContextCache({ dream_id: dreamId });

  // Step 9: markWeeklyReviewOutcome (TS-only — Q8).
  await acts.markWeeklyReviewOutcome({ dream_id: dreamId, outcome: 'completed' });

  // Step 10: return.
  return { dream_id: dreamId, status: 'completed', pr_url: prUrl };
}
