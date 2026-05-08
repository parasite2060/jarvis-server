/**
 * Unit tests for `weeklyReviewWorkflow` (Story 13.12 / AC #11).
 *
 * Two test surfaces:
 *   1. Pure ISO-week helper (covered by `iso-week.spec.ts`).
 *   2. Full workflow paths via `TestWorkflowEnvironment.createTimeSkipping()`
 *      with stub activity implementations covering the 8 scenarios per AC #11.
 *
 * @group temporal
 */
import { Worker } from '@temporalio/worker';
import { TestWorkflowEnvironment } from '@temporalio/testing';
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
  WriteReviewInput,
  WriteReviewResult,
} from '../types/weekly-review.types';

describe('weeklyReviewWorkflow — Temporal scenarios', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
  }, 30_000);

  afterAll(async () => {
    await testEnv?.teardown();
  });

  type Overrides = Partial<{
    gatherDailys: (inp: WeeklyReviewPayload) => Promise<GatherDailysResult>;
    gatherIndexes: (inp: GatherIndexesInput) => Promise<GatherIndexesResult>;
    runWeeklyReviewAgent: (inp: AgentInput) => Promise<AgentResult>;
    writeReviewFile: (inp: WriteReviewInput) => Promise<WriteReviewResult>;
    commitAndPr: (inp: WeeklyCommitAndPRInput) => Promise<CommitAndPRResult>;
    invalidateContextCache: (inp: InvalidateCacheInput) => Promise<void>;
    markWeeklyReviewOutcome: (inp: MarkWeeklyReviewOutcomeInput) => Promise<void>;
  }>;

  function buildActivities(overrides: Overrides = {}, calls: string[] = []): Record<string, unknown> {
    const trace = (name: string) => calls.push(name);
    return {
      'weekly.gather_dailys':
        overrides.gatherDailys ??
        (async () => {
          trace('gather');
          return {
            dream_id: 100,
            week_start: '2026-05-04',
            daily_logs: { '2026-05-04': 'mon', '2026-05-05': 'tue' },
          };
        }),
      'weekly.gather_indexes':
        overrides.gatherIndexes ??
        (async () => {
          trace('gatherIndexes');
          return { vault_indexes: { decisions: 'idx' }, vault_guide: 'guide' };
        }),
      'weekly.run_weekly_review_agent':
        overrides.runWeeklyReviewAgent ??
        (async () => {
          trace('runAgent');
          return {
            review_content: '# Weekly Review: 2026-W19\n\nbody',
            week_themes: ['theme'],
            stale_action_items: [],
            project_updates: { TaskFlow: 'shipped' },
            input_tokens: null,
            output_tokens: null,
            total_tokens: null,
            tool_calls: null,
          };
        }),
      'weekly.write_review_file':
        overrides.writeReviewFile ??
        (async () => {
          trace('writeReview');
          return {
            review_path: 'reviews/2026-W19.md',
            files_modified: [{ path: 'reviews/2026-W19.md', action: 'create' }],
            vault_writes: [{ path: 'reviews/2026-W19.md', content: 'BODY', action: 'create' }],
          };
        }),
      'weekly.commit_and_pr':
        overrides.commitAndPr ??
        (async () => {
          trace('commit');
          return { git_branch: 'dream/review-2026-W19', git_pr_url: 'https://pr/1', git_pr_status: 'created' };
        }),
      'weekly.invalidate_cache':
        overrides.invalidateContextCache ??
        (async () => {
          trace('invalidate');
        }),
      'weekly.mark_dream_outcome':
        overrides.markWeeklyReviewOutcome ??
        (async () => {
          trace('markOutcome');
        }),
    };
  }

  async function runWorkflow(activities: Record<string, unknown>, payload: WeeklyReviewPayload = { week_start: '2026-05-04', trigger: 'auto' }) {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: 'test-weekly-review',
      workflowsPath: require.resolve('./index.ts'),
      activities: activities as Parameters<typeof Worker.create>[0]['activities'],
    });
    return (await worker.runUntil(
      testEnv.client.workflow.execute('WeeklyReview', {
        workflowId: `test-weekly-${Date.now()}-${Math.random()}`,
        taskQueue: 'test-weekly-review',
        args: [payload],
      }),
    )) as { dream_id: number; status: 'completed' | 'partial' | 'skipped'; pr_url: string | null };
  }

  // (1) Happy path — all 7 activities, status=completed, pr_url present.
  it('AC#11 (1) — happy path: all 7 activities run in order, status=completed', async () => {
    const calls: string[] = [];
    const result = await runWorkflow(buildActivities({}, calls));
    expect(result.status).toBe('completed');
    expect(result.dream_id).toBe(100);
    expect(result.pr_url).toBe('https://pr/1');
    expect(calls).toEqual(['gather', 'gatherIndexes', 'runAgent', 'writeReview', 'commit', 'invalidate', 'markOutcome']);
  }, 60_000);

  // (2) Empty week — gatherDailys raises non-retryable → workflow propagates.
  it('AC#11 (2) — gatherDailys non-retryable failure propagates (Q5)', async () => {
    const { ApplicationFailure } = await import('@temporalio/common');
    const overrides: Overrides = {
      gatherDailys: async () => {
        throw ApplicationFailure.nonRetryable('No daily logs', 'WEEKLY_REVIEW_EMPTY_WEEK');
      },
    };
    await expect(runWorkflow(buildActivities(overrides))).rejects.toThrow();
  }, 60_000);

  // (3) Empty review — agent returns empty review_content → skip write+commit+invalidate.
  it('AC#11 (3) — empty review_content → skip write/commit/invalidate; mark completed; pr_url null', async () => {
    const calls: string[] = [];
    const overrides: Overrides = {
      runWeeklyReviewAgent: async () => {
        calls.push('runAgent');
        return {
          review_content: '',
          week_themes: [],
          stale_action_items: [],
          project_updates: {},
          input_tokens: null,
          output_tokens: null,
          total_tokens: null,
          tool_calls: null,
        };
      },
    };
    const result = await runWorkflow(buildActivities(overrides, calls));
    expect(result.status).toBe('completed');
    expect(result.pr_url).toBeNull();
    expect(calls).toContain('runAgent');
    expect(calls).toContain('markOutcome');
    expect(calls).not.toContain('writeReview');
    expect(calls).not.toContain('commit');
    expect(calls).not.toContain('invalidate');
  }, 60_000);

  // (4) ISO-week year-boundary — workflow uses Luxon weekIso for branch/file.
  it('AC#11 (4) — ISO-week year-boundary: 2025-12-29 (Mon) → 2026-W01 in commit input', async () => {
    let capturedCommitInput: WeeklyCommitAndPRInput | null = null;
    let capturedWriteInput: WriteReviewInput | null = null;
    const overrides: Overrides = {
      writeReviewFile: async (inp) => {
        capturedWriteInput = inp;
        return {
          review_path: 'reviews/2026-W01.md',
          files_modified: [{ path: 'reviews/2026-W01.md', action: 'create' }],
          vault_writes: [{ path: 'reviews/2026-W01.md', content: 'b', action: 'create' }],
        };
      },
      commitAndPr: async (inp) => {
        capturedCommitInput = inp;
        return { git_branch: `dream/review-${inp.week_iso}`, git_pr_url: '', git_pr_status: 'created' };
      },
    };
    await runWorkflow(buildActivities(overrides), { week_start: '2025-12-29', trigger: 'auto' });
    expect((capturedWriteInput as unknown as WriteReviewInput).week_start).toBe('2025-12-29');
    expect((capturedCommitInput as unknown as WeeklyCommitAndPRInput).week_iso).toBe('2026-W01');
  }, 60_000);

  // (5) Branch byte-equivalence — `dream/review-${week_iso}` flows through.
  it('AC#11 (5) — week_iso "2026-W19" produces commit input with that exact value', async () => {
    let capturedCommit: WeeklyCommitAndPRInput | null = null;
    const overrides: Overrides = {
      commitAndPr: async (inp) => {
        capturedCommit = inp;
        return { git_branch: `dream/review-${inp.week_iso}`, git_pr_url: 'https://pr/x', git_pr_status: 'created' };
      },
    };
    const result = await runWorkflow(buildActivities(overrides), { week_start: '2026-05-04' });
    expect((capturedCommit as unknown as WeeklyCommitAndPRInput).week_iso).toBe('2026-W19');
    expect(result.pr_url).toBe('https://pr/x');
  }, 60_000);

  // (6) PR-body shape passes through commitAndPr unchanged (activity tests build).
  // The workflow itself just forwards files_modified/vault_writes; we assert
  // that the same triple flows through.
  it('AC#11 (6) — workflow forwards write triple to commitAndPr unchanged', async () => {
    let capturedCommit: WeeklyCommitAndPRInput | null = null;
    const triple = { path: 'reviews/2026-W19.md', content: 'CONTENT', action: 'create' as const };
    const overrides: Overrides = {
      writeReviewFile: async () => ({
        review_path: 'reviews/2026-W19.md',
        files_modified: [{ path: triple.path, action: triple.action }],
        vault_writes: [triple],
      }),
      commitAndPr: async (inp) => {
        capturedCommit = inp;
        return { git_branch: 'b', git_pr_url: '', git_pr_status: 'created' };
      },
    };
    await runWorkflow(buildActivities(overrides));
    expect((capturedCommit as unknown as WeeklyCommitAndPRInput).vault_writes).toEqual([triple]);
    expect((capturedCommit as unknown as WeeklyCommitAndPRInput).files_modified).toEqual([{ path: triple.path, action: triple.action }]);
  }, 60_000);

  // (7) Empty git_pr_url returned by commitAndPr → workflow returns pr_url=null.
  it('AC#11 (7) — empty git_pr_url → workflow returns pr_url=null', async () => {
    const overrides: Overrides = {
      commitAndPr: async () => ({ git_branch: 'b', git_pr_url: '', git_pr_status: 'no_files' }),
    };
    const result = await runWorkflow(buildActivities(overrides));
    expect(result.pr_url).toBeNull();
    expect(result.status).toBe('completed');
  }, 60_000);

  // (8) Activity-call ordering: gather BEFORE indexes BEFORE agent BEFORE write
  //     BEFORE commit BEFORE invalidate BEFORE markOutcome.
  it('AC#11 (8) — activity-call ordering preserved across full run', async () => {
    const calls: string[] = [];
    await runWorkflow(buildActivities({}, calls));
    const expectedOrder = ['gather', 'gatherIndexes', 'runAgent', 'writeReview', 'commit', 'invalidate', 'markOutcome'];
    expect(calls).toEqual(expectedOrder);
  }, 60_000);
});
