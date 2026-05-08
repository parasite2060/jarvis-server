/**
 * deepDreamWorkflow — TS port of `app/workflows/deep_dream_workflow.py` (Story 13.11).
 *
 * # SANDBOX-CLEAN — Temporal replays this code on recovery.
 *   This file imports ONLY from `@temporalio/workflow` AND type-only imports
 *   from `../types/deep-dream.types` (deleted). NO NestJS, NO `fs`, NO `crypto`,
 *   NO `Math.random()`, NO `src/...` runtime imports.
 *
 *   Per the Story 13.10 Finding 3 reversal (verified against
 *   `@temporalio/workflow/lib/global-overrides.js:43-47`): `Date.now()` and
 *   `new Date()` are MONKEY-PATCHED inside the SDK to return the
 *   activator's deterministic time and ARE replay-safe in this version.
 *   We use them sparingly via pure arithmetic (no clock reads in business
 *   logic) — the only branch that touches a date here is summary
 *   formatting which doesn't read the clock.
 *
 * # MC3 wire frozen
 *   - Workflow type: `DeepDream` (registered via aliased re-export in
 *     `workflows/index.ts` — Story 13.10 / Q1 actual landed pattern).
 *   - Activity wire names: `deep.<snake_case>` per Dev Notes §B.
 *   - Snake_case payload keys preserved verbatim.
 *
 * # Q2 RESOLVED 2026-05-08: 6 proxyActivities groups by policy
 *   - quickProxy   (timeout 30s-2min, retries 3-5): gather, score, healthCheck,
 *     writeFiles, commitAndPr, invalidateCache, markDeepDreamOutcome.
 *   - phase1Proxy  (10min, retries 2): runPhase1LightSleep.
 *   - phase2Proxy  (10min, retries 2): runPhase2RemSleep (soft-fails internally).
 *   - phase3Proxy  (15min, retries 2): runPhase3DeepSleep.
 *   - healthFixProxy (10min, retries 1 — Python uses 1 attempt only; loop is
 *     INSIDE the activity): runHealthFix.
 *   - alignMemuProxy (5min, retries 3): alignMemu.
 *
 * # Activity ordering (per AC #3 — mirrors Python lines 91-332)
 *   1. gatherInputs
 *   2. (skip-guard) empty inputs → mark skipped + return
 *   3. runPhase1LightSleep
 *   4. (skip-guard) no candidates → mark skipped + return
 *   5. scoreCandidates
 *   6. runPhase2RemSleep (soft-fails internally → output_json: null)
 *   7. inline format helpers (sandbox-safe)
 *   8. runPhase3DeepSleep
 *   9. runHealthCheck
 *   10. (conditional) runHealthFix → flip is_partial on 'incomplete'
 *   11. writeFiles
 *   12. (conditional) commitAndPr if files_modified.length > 0
 *   13. alignMemu
 *   14. invalidateContextCache
 *   15. markDeepDreamOutcome
 *   16. return DeepDreamResult
 */
import { proxyActivities, log } from '@temporalio/workflow';

// ---------------------------------------------------------------------------
// Activity I/O wire types (Q6 RESOLVED 2026-05-08 by TanNT — inlined here
// from former `temporal/types/deep-dream.types.ts` which was deleted to
// match module-map §1).
//
// # Q8 binding — snake_case keys mirror Python `app/activities/deep/_models.py`
//   field-for-field (MC3 + MC5 byte-equivalence).
// # Sandbox-safe: type-only declarations (erased at runtime).
// ---------------------------------------------------------------------------

export interface DeepDreamPayload {
  /** ISO format YYYY-MM-DD (e.g., '2026-05-07'). Drives branch name + dream_id key. */
  target_date: string;
  /** 'auto' (Temporal Schedule) | 'manual' (POST /dream). Default 'auto'. */
  trigger?: string;
  source_date_iso?: string | null;
}

export interface DeepDreamResult {
  dream_id: number;
  status: 'completed' | 'partial' | 'skipped';
  pr_url?: string | null;
  error_message?: string | null;
}

export interface GatherInputsResult {
  dream_id: number;
  memu_memories: Array<Record<string, unknown>>;
  memory_md: string;
  daily_log: string;
  soul_md: string;
  source_date_iso: string;
}

export interface Phase1Input {
  dream_id: number;
  memu_memories: Array<Record<string, unknown>>;
  memory_md: string;
  daily_log: string;
  soul_md: string;
  source_date_iso: string;
}

export interface LightSleepResult {
  candidates_json: Array<Record<string, unknown>>;
  duplicates_removed: number;
  contradictions_found: number;
}

export interface ScoringInput {
  dream_id: number;
  candidates_json: Array<Record<string, unknown>>;
}

export interface ScoredCandidatesResult {
  scored: Array<Record<string, unknown>>;
}

export interface Phase2Input {
  dream_id: number;
  source_date_iso: string;
  candidates_json: Array<Record<string, unknown>>;
  scored_json: Array<Record<string, unknown>>;
}

export interface REMSleepResult {
  output_json: Record<string, unknown> | null;
}

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
  consolidation_json: Record<string, unknown>;
  messages_json: Array<Record<string, unknown>>;
  usage_input_tokens: number | null;
  usage_output_tokens: number | null;
  usage_total_tokens: number | null;
  usage_tool_calls: number | null;
}

export interface HealthCheckInput {
  dream_id: number;
  source_date_iso: string;
  knowledge_gap_names: string[];
}

export interface HealthReportResult {
  report_json: Record<string, unknown>;
  total_issues: number;
}

export interface HealthFixInput {
  dream_id: number;
  source_date_iso: string;
  report_json: Record<string, unknown>;
  consolidation_messages_json: Array<Record<string, unknown>>;
  knowledge_gap_names: string[];
}

export interface HealthFixResult {
  status: 'clean' | 'fixed' | 'incomplete';
  report_json: Record<string, unknown>;
  total_issues_remaining: number;
}

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

export interface DeepCommitAndPRInput {
  dream_id: number;
  target_date_iso: string;
  files_modified: WriteFilesFileEntry[];
  vault_writes: Array<{ path: string; content: string; action: 'create' | 'update' }>;
  stats: Record<string, unknown>;
}

export interface CommitAndPRResult {
  git_branch: string;
  git_pr_url: string;
  /** 'created' | 'existing' | 'no_files' | 'merged'. */
  git_pr_status: string;
}

export interface AlignMemuInput {
  dream_id: number;
  memory_md: string;
  source_date_iso: string;
  /** `dream-{dream_id}` — the file-based idempotency key. */
  idempotency_key: string;
}

export interface InvalidateCacheInput {
  dream_id: number;
}

/** TS-only enhancement (Q13) — Python doesn't update dream.outcome. */
export interface MarkDeepDreamOutcomeInput {
  dream_id: number;
  outcome: 'completed' | 'partial' | 'skipped';
}

// ---------------------------------------------------------------------------
// Activity proxies — six policy groups per Q2.
// ---------------------------------------------------------------------------

interface QuickActs {
  'deep.gather_inputs'(inp: DeepDreamPayload): Promise<GatherInputsResult>;
  'deep.score_candidates'(inp: ScoringInput): Promise<ScoredCandidatesResult>;
  'deep.health_check'(inp: HealthCheckInput): Promise<HealthReportResult>;
  'deep.write_files'(inp: WriteFilesInput): Promise<WriteFilesResult>;
  'deep.commit_and_pr'(inp: DeepCommitAndPRInput): Promise<CommitAndPRResult>;
  'deep.invalidate_cache'(inp: InvalidateCacheInput): Promise<void>;
  'deep.mark_dream_outcome'(inp: MarkDeepDreamOutcomeInput): Promise<void>;
}

const quickProxy = proxyActivities<QuickActs>({
  startToCloseTimeout: '2 minutes',
  retry: {
    initialInterval: '2s',
    backoffCoefficient: 2,
    maximumInterval: '30s',
    maximumAttempts: 3,
  },
});

interface Phase1Acts {
  'deep.phase1_light_sleep'(inp: Phase1Input): Promise<LightSleepResult>;
}
const phase1Proxy = proxyActivities<Phase1Acts>({
  startToCloseTimeout: '10 minutes',
  retry: { initialInterval: '5s', backoffCoefficient: 2, maximumInterval: '60s', maximumAttempts: 2 },
});

interface Phase2Acts {
  'deep.phase2_rem_sleep'(inp: Phase2Input): Promise<REMSleepResult>;
}
const phase2Proxy = proxyActivities<Phase2Acts>({
  startToCloseTimeout: '10 minutes',
  retry: { initialInterval: '5s', backoffCoefficient: 2, maximumInterval: '60s', maximumAttempts: 2 },
});

interface Phase3Acts {
  'deep.phase3_deep_sleep'(inp: Phase3Input): Promise<ConsolidationResult>;
}
const phase3Proxy = proxyActivities<Phase3Acts>({
  startToCloseTimeout: '15 minutes',
  retry: { initialInterval: '10s', backoffCoefficient: 2, maximumInterval: '120s', maximumAttempts: 2 },
});

interface HealthFixActs {
  'deep.health_fix'(inp: HealthFixInput): Promise<HealthFixResult>;
}
const healthFixProxy = proxyActivities<HealthFixActs>({
  startToCloseTimeout: '10 minutes',
  retry: { initialInterval: '5s', backoffCoefficient: 2, maximumInterval: '60s', maximumAttempts: 1 },
});

interface AlignMemuActs {
  'deep.align_memu'(inp: AlignMemuInput): Promise<void>;
}
const alignMemuProxy = proxyActivities<AlignMemuActs>({
  startToCloseTimeout: '5 minutes',
  retry: { initialInterval: '5s', backoffCoefficient: 2, maximumInterval: '60s', maximumAttempts: 3 },
});

// Local TS-idiomatic camelCase aliases — keep workflow body readable.
const acts = {
  gatherInputs: quickProxy['deep.gather_inputs'],
  scoreCandidates: quickProxy['deep.score_candidates'],
  runHealthCheck: quickProxy['deep.health_check'],
  writeFiles: quickProxy['deep.write_files'],
  commitAndPr: quickProxy['deep.commit_and_pr'],
  invalidateContextCache: quickProxy['deep.invalidate_cache'],
  markDeepDreamOutcome: quickProxy['deep.mark_dream_outcome'],
  runPhase1LightSleep: phase1Proxy['deep.phase1_light_sleep'],
  runPhase2RemSleep: phase2Proxy['deep.phase2_rem_sleep'],
  runPhase3DeepSleep: phase3Proxy['deep.phase3_deep_sleep'],
  runHealthFix: healthFixProxy['deep.health_fix'],
  alignMemu: alignMemuProxy['deep.align_memu'],
};

// ---------------------------------------------------------------------------
// Deterministic inline helpers (sandbox-safe — pure data manipulation).
// ---------------------------------------------------------------------------

/**
 * Mirrors Python `_format_phase1_summary` (`deep_dream_workflow.py:61-73`).
 * Note: workflow-side rounds to 3 decimals (Python parity); the activity-side
 * `formatPhase1ForPhase2` (Q5 re-creation) rounds to 2 decimals — this
 * inconsistency is intentional per Dev Notes §N #4.
 */
export function formatPhase1Summary(candidates: Array<Record<string, unknown>>, scoredJson: Array<Record<string, unknown>>): string {
  const scoreMap = new Map<string, number>();
  for (const s of scoredJson) {
    const content = typeof s['content'] === 'string' ? s['content'] : '';
    const score = typeof s['score'] === 'number' ? s['score'] : 0;
    scoreMap.set(content, score);
  }
  const lines: string[] = ['## Phase 1: Light Sleep Results', ''];
  lines.push(`Candidates: ${candidates.length}`);
  lines.push('');
  for (const c of candidates) {
    const content = typeof c['content'] === 'string' ? c['content'] : '';
    const category = typeof c['category'] === 'string' ? c['category'] : '';
    const reinforced = typeof c['reinforcement_count'] === 'number' ? c['reinforcement_count'] : 0;
    const score = Math.round((scoreMap.get(content) ?? 0) * 1000) / 1000;
    const flag = c['contradiction_flag'] === true ? ' [CONTRADICTION]' : '';
    lines.push(`- (${category}) ${content} [score=${score}, reinforced=${reinforced}]${flag}`);
  }
  return lines.join('\n');
}

/**
 * Mirrors Python `_format_phase2_summary` (`deep_dream_workflow.py:76-86`).
 * Returns empty string when output_json is null (Phase 2 soft-fail path).
 */
export function formatPhase2Summary(outputJson: Record<string, unknown> | null): string {
  if (outputJson === null) return '';
  const lines: string[] = ['## Phase 2: REM Sleep Results', ''];
  const themes = Array.isArray(outputJson['themes']) ? outputJson['themes'] : [];
  lines.push(`Themes: ${themes.length}`);
  const connections = Array.isArray(outputJson['new_connections']) ? outputJson['new_connections'] : [];
  lines.push(`Connections: ${connections.length}`);
  const gaps = Array.isArray(outputJson['gaps']) ? outputJson['gaps'] : [];
  lines.push(`Gaps: ${gaps.length}`);
  return lines.join('\n');
}

/**
 * Extract `concept` strings from Phase 2 gap entries. Pure data extraction.
 */
export function extractKnowledgeGapNames(outputJson: Record<string, unknown> | null): string[] {
  if (outputJson === null) return [];
  const gaps = Array.isArray(outputJson['gaps']) ? outputJson['gaps'] : [];
  const out: string[] = [];
  for (const g of gaps) {
    if (g !== null && typeof g === 'object') {
      const concept = (g as { concept?: unknown }).concept;
      if (typeof concept === 'string' && concept.length > 0) {
        out.push(concept);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Workflow entry point.
// ---------------------------------------------------------------------------

export async function deepDreamWorkflow(payload: DeepDreamPayload): Promise<DeepDreamResult> {
  // Step 1: gather inputs (creates Dream row, reads vault, snapshots MemU).
  const gather = await acts.gatherInputs(payload);
  const dreamId = gather.dream_id;

  // Step 2: skip-guard 1 — empty inputs.
  if (gather.memu_memories.length === 0 && gather.daily_log.trim() === '') {
    log.info('deepDream.workflow.skipped', { dream_id: dreamId, reason: 'emptyInputs' });
    await acts.markDeepDreamOutcome({ dream_id: dreamId, outcome: 'skipped' });
    return { dream_id: dreamId, status: 'skipped', pr_url: null };
  }

  // Step 3: Phase 1 — Light Sleep.
  const phase1: LightSleepResult = await acts.runPhase1LightSleep({
    dream_id: dreamId,
    memu_memories: gather.memu_memories,
    memory_md: gather.memory_md,
    daily_log: gather.daily_log,
    soul_md: gather.soul_md,
    source_date_iso: gather.source_date_iso,
  });

  // Step 4: skip-guard 2 — no candidates.
  if (phase1.candidates_json.length === 0) {
    log.info('deepDream.workflow.skipped', { dream_id: dreamId, reason: 'noPhase1Candidates' });
    await acts.markDeepDreamOutcome({ dream_id: dreamId, outcome: 'skipped' });
    return { dream_id: dreamId, status: 'skipped', pr_url: null };
  }

  // Step 5: deterministic scoring (pure TS, NO LLM).
  const scored: ScoredCandidatesResult = await acts.scoreCandidates({
    dream_id: dreamId,
    candidates_json: phase1.candidates_json,
  });

  // Step 6: Phase 2 — REM Sleep (soft-fails internally).
  const phase2: REMSleepResult = await acts.runPhase2RemSleep({
    dream_id: dreamId,
    source_date_iso: gather.source_date_iso,
    candidates_json: phase1.candidates_json,
    scored_json: scored.scored,
  });

  // Step 7: deterministic helpers.
  const phase1Summary = formatPhase1Summary(phase1.candidates_json, scored.scored);
  const phase2Summary = formatPhase2Summary(phase2.output_json);
  const knowledgeGapNames = extractKnowledgeGapNames(phase2.output_json);

  // Step 8: Phase 3 — Deep Sleep / Consolidation.
  const consolidation: ConsolidationResult = await acts.runPhase3DeepSleep({
    dream_id: dreamId,
    source_date_iso: gather.source_date_iso,
    memu_memories: gather.memu_memories,
    memory_md: gather.memory_md,
    daily_log: gather.daily_log,
    soul_md: gather.soul_md,
    phase1_summary: phase1Summary,
    phase2_summary: phase2Summary,
  });

  // Step 9: deterministic health-check.
  const healthReport: HealthReportResult = await acts.runHealthCheck({
    dream_id: dreamId,
    source_date_iso: gather.source_date_iso,
    knowledge_gap_names: knowledgeGapNames,
  });

  // Step 10: conditional Health Fix.
  let isPartial = false;
  if (healthReport.total_issues > 0) {
    const fixResult: HealthFixResult = await acts.runHealthFix({
      dream_id: dreamId,
      source_date_iso: gather.source_date_iso,
      report_json: healthReport.report_json,
      consolidation_messages_json: consolidation.messages_json,
      knowledge_gap_names: knowledgeGapNames,
    });
    if (fixResult.status === 'incomplete') {
      isPartial = true;
    }
  }

  // Step 11: writeFiles — collects vault_writes triples (Q3 deviation).
  const writeResult: WriteFilesResult = await acts.writeFiles({
    dream_id: dreamId,
    source_date_iso: gather.source_date_iso,
    consolidation_json: consolidation.consolidation_json,
  });

  // Step 12: conditional commit + PR.
  let prUrl: string | null = null;
  if (writeResult.files_modified.length > 0) {
    const stats = (consolidation.consolidation_json['stats'] as Record<string, unknown>) ?? {};
    const commitResult = await acts.commitAndPr({
      dream_id: dreamId,
      target_date_iso: payload.target_date,
      files_modified: writeResult.files_modified,
      vault_writes: writeResult.vault_writes,
      stats,
    });
    prUrl = commitResult.git_pr_url.length > 0 ? commitResult.git_pr_url : null;
  }

  // Step 13: align MemU — always runs.
  await acts.alignMemu({
    dream_id: dreamId,
    memory_md: typeof consolidation.consolidation_json['memory_md'] === 'string' ? consolidation.consolidation_json['memory_md'] : '',
    source_date_iso: gather.source_date_iso,
    idempotency_key: `dream-${dreamId}`,
  });

  // Step 14: invalidate context cache — always runs.
  await acts.invalidateContextCache({ dream_id: dreamId });

  // Step 15: outcome update (TS-only enhancement).
  const outcome: 'completed' | 'partial' = isPartial ? 'partial' : 'completed';
  await acts.markDeepDreamOutcome({ dream_id: dreamId, outcome });
  if (isPartial) {
    log.warn('deepDream.workflow.partialReturn', { dream_id: dreamId, partial: true });
  }

  return { dream_id: dreamId, status: outcome, pr_url: prUrl };
}
