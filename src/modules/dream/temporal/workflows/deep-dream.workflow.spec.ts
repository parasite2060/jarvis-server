/**
 * Unit tests for `deepDreamWorkflow` (Story 13.11 / AC #17 / Q15).
 *
 * Two test surfaces:
 *   1. Pure deterministic helpers (`formatPhase1Summary`, `formatPhase2Summary`,
 *      `extractKnowledgeGapNames`) — testable in plain Jest.
 *   2. Full workflow paths via `TestWorkflowEnvironment.createTimeSkipping()`
 *      with stub activity implementations covering Q15's 12 scenarios.
 *
 * @group temporal
 */
import { Worker } from '@temporalio/worker';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { extractKnowledgeGapNames, formatPhase1Summary, formatPhase2Summary } from './deep-dream.workflow';
import type {
  GatherInputsResult,
  LightSleepResult,
  ScoredCandidatesResult,
  REMSleepResult,
  ConsolidationResult,
  HealthReportResult,
  HealthFixResult,
  WriteFilesResult,
  CommitAndPRResult,
  AlignMemuInput,
  InvalidateCacheInput,
  MarkDeepDreamOutcomeInput,
  DeepCommitAndPRInput,
  WriteFilesInput,
  HealthFixInput,
  HealthCheckInput,
  Phase3Input,
  Phase2Input,
  ScoringInput,
  Phase1Input,
  DeepDreamPayload,
} from '../types/deep-dream.types';

describe('deepDreamWorkflow — pure helpers', () => {
  describe('formatPhase1Summary', () => {
    it('formats candidates with score, reinforcement, contradiction flag', () => {
      const candidates = [
        { content: 'a', category: 'decisions', reinforcement_count: 3, contradiction_flag: false, source_sessions: [] },
        { content: 'b', category: 'patterns', reinforcement_count: 5, contradiction_flag: true, source_sessions: [] },
      ];
      const scored = [
        { content: 'a', score: 0.7654 },
        { content: 'b', score: 0.812 },
      ];
      const out = formatPhase1Summary(candidates, scored);
      expect(out).toContain('## Phase 1: Light Sleep Results');
      expect(out).toContain('Candidates: 2');
      expect(out).toContain('(decisions) a [score=0.765, reinforced=3]');
      expect(out).toContain('(patterns) b [score=0.812, reinforced=5] [CONTRADICTION]');
    });

    it('handles empty candidates', () => {
      const out = formatPhase1Summary([], []);
      expect(out).toContain('Candidates: 0');
    });
  });

  describe('formatPhase2Summary', () => {
    it('formats counts when output_json is non-null', () => {
      const out = formatPhase2Summary({ themes: [{}, {}], new_connections: [{}], gaps: [{}, {}, {}] });
      expect(out).toContain('Themes: 2');
      expect(out).toContain('Connections: 1');
      expect(out).toContain('Gaps: 3');
    });

    it('returns empty string when output_json is null (Phase 2 soft-fail)', () => {
      expect(formatPhase2Summary(null)).toBe('');
    });
  });

  describe('extractKnowledgeGapNames', () => {
    it('returns concept strings from gap entries', () => {
      const out = extractKnowledgeGapNames({ gaps: [{ concept: 'X' }, { concept: 'Y' }, { concept: '' }] });
      expect(out).toEqual(['X', 'Y']);
    });

    it('returns [] for null output_json', () => {
      expect(extractKnowledgeGapNames(null)).toEqual([]);
    });

    it('returns [] when gaps is missing or non-array', () => {
      expect(extractKnowledgeGapNames({})).toEqual([]);
      expect(extractKnowledgeGapNames({ gaps: 'not-array' })).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// Temporal scenarios — 12 cases per Q15.
// ---------------------------------------------------------------------------

describe('deepDreamWorkflow — Temporal scenarios', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
  }, 30_000);

  afterAll(async () => {
    await testEnv?.teardown();
  });

  type Overrides = Partial<{
    gatherInputs: (inp: DeepDreamPayload) => Promise<GatherInputsResult>;
    runPhase1LightSleep: (inp: Phase1Input) => Promise<LightSleepResult>;
    scoreCandidates: (inp: ScoringInput) => Promise<ScoredCandidatesResult>;
    runPhase2RemSleep: (inp: Phase2Input) => Promise<REMSleepResult>;
    runPhase3DeepSleep: (inp: Phase3Input) => Promise<ConsolidationResult>;
    runHealthCheck: (inp: HealthCheckInput) => Promise<HealthReportResult>;
    runHealthFix: (inp: HealthFixInput) => Promise<HealthFixResult>;
    writeFiles: (inp: WriteFilesInput) => Promise<WriteFilesResult>;
    commitAndPr: (inp: DeepCommitAndPRInput) => Promise<CommitAndPRResult>;
    alignMemu: (inp: AlignMemuInput) => Promise<void>;
    invalidateContextCache: (inp: InvalidateCacheInput) => Promise<void>;
    markDeepDreamOutcome: (inp: MarkDeepDreamOutcomeInput) => Promise<void>;
  }>;

  function buildActivities(overrides: Overrides = {}, calls: string[] = []): Record<string, unknown> {
    const trace = (name: string) => calls.push(name);
    return {
      'deep.gather_inputs':
        overrides.gatherInputs ??
        (async () => {
          trace('gather');
          return {
            dream_id: 100,
            memu_memories: [{ content: 'm1' }],
            memory_md: '## Strong Patterns\n- foo',
            daily_log: 'Some daily log content',
            soul_md: 'Soul body',
            source_date_iso: '2026-05-07',
          };
        }),
      'deep.phase1_light_sleep':
        overrides.runPhase1LightSleep ??
        (async () => {
          trace('phase1');
          return {
            candidates_json: [{ content: 'c1', category: 'decisions', reinforcement_count: 3, contradiction_flag: false, source_sessions: [] }],
            duplicates_removed: 0,
            contradictions_found: 0,
          };
        }),
      'deep.score_candidates':
        overrides.scoreCandidates ??
        (async () => {
          trace('score');
          return { scored: [{ content: 'c1', score: 0.65 }] };
        }),
      'deep.phase2_rem_sleep':
        overrides.runPhase2RemSleep ??
        (async () => {
          trace('phase2');
          return { output_json: { themes: [], new_connections: [], gaps: [] } };
        }),
      'deep.phase3_deep_sleep':
        overrides.runPhase3DeepSleep ??
        (async () => {
          trace('phase3');
          return {
            consolidation_json: {
              memory_md: 'updated memory',
              daily_summary: 'summary',
              stats: { total_memories_processed: 1, duplicates_removed: 0, contradictions_resolved: 0 },
              vault_updates: { decisions: [], projects: [], patterns: [], templates: [], concepts: [], connections: [], lessons: [], topics: [] },
            },
            messages_json: [],
            usage_input_tokens: null,
            usage_output_tokens: null,
            usage_total_tokens: null,
            usage_tool_calls: null,
          };
        }),
      'deep.health_check':
        overrides.runHealthCheck ??
        (async () => {
          trace('healthCheck');
          return { report_json: {}, total_issues: 0 };
        }),
      'deep.health_fix':
        overrides.runHealthFix ??
        (async () => {
          trace('healthFix');
          return { status: 'clean', report_json: {}, total_issues_remaining: 0 };
        }),
      'deep.write_files':
        overrides.writeFiles ??
        (async () => {
          trace('writeFiles');
          return {
            files_modified: [{ path: 'MEMORY.md', action: 'rewrite' }],
            vault_writes: [{ path: 'MEMORY.md', content: 'updated memory', action: 'update' }],
          };
        }),
      'deep.commit_and_pr':
        overrides.commitAndPr ??
        (async () => {
          trace('commit');
          return { git_branch: 'dream/deep-2026-05-07', git_pr_url: 'http://pr/1', git_pr_status: 'created' };
        }),
      'deep.align_memu':
        overrides.alignMemu ??
        (async () => {
          trace('alignMemu');
        }),
      'deep.invalidate_cache':
        overrides.invalidateContextCache ??
        (async () => {
          trace('invalidate');
        }),
      'deep.mark_dream_outcome':
        overrides.markDeepDreamOutcome ??
        (async () => {
          trace('markOutcome');
        }),
    };
  }

  async function runWorkflow(activities: Record<string, unknown>, payload: DeepDreamPayload = { target_date: '2026-05-07', trigger: 'auto' }) {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: 'test-deep-dream',
      workflowsPath: require.resolve('./index.ts'),
      activities: activities as Parameters<typeof Worker.create>[0]['activities'],
    });
    return (await worker.runUntil(
      testEnv.client.workflow.execute('DeepDream', {
        workflowId: `test-deep-${Date.now()}-${Math.random()}`,
        taskQueue: 'test-deep-dream',
        args: [payload],
      }),
    )) as { dream_id: number; status: 'completed' | 'partial' | 'skipped'; pr_url: string | null };
  }

  // (1) Happy path
  it('Q15 (1) — happy path: all 12 activities, status=completed, pr_url present', async () => {
    const calls: string[] = [];
    const result = await runWorkflow(buildActivities({}, calls));
    expect(result.status).toBe('completed');
    expect(result.dream_id).toBe(100);
    expect(result.pr_url).toBe('http://pr/1');
    expect(calls).toEqual([
      'gather',
      'phase1',
      'score',
      'phase2',
      'phase3',
      'healthCheck',
      'writeFiles',
      'commit',
      'alignMemu',
      'invalidate',
      'markOutcome',
    ]);
  }, 60_000);

  // (2) Skip-guard 1 — empty inputs.
  it('Q15 (2) — empty MemU + empty daily log → status=skipped, no Phase 1', async () => {
    const calls: string[] = [];
    const overrides: Overrides = {
      gatherInputs: async () => {
        calls.push('gather');
        return { dream_id: 200, memu_memories: [], memory_md: '', daily_log: '', soul_md: '', source_date_iso: '2026-05-07' };
      },
    };
    const result = await runWorkflow(buildActivities(overrides, calls));
    expect(result.status).toBe('skipped');
    expect(calls).toContain('gather');
    expect(calls).not.toContain('phase1');
  }, 60_000);

  // (3) Skip-guard 2 — no candidates from Phase 1.
  it('Q15 (3) — Phase 1 returns no candidates → status=skipped, no Phase 2/3', async () => {
    const calls: string[] = [];
    const overrides: Overrides = {
      runPhase1LightSleep: async () => {
        calls.push('phase1');
        return { candidates_json: [], duplicates_removed: 0, contradictions_found: 0 };
      },
    };
    const result = await runWorkflow(buildActivities(overrides, calls));
    expect(result.status).toBe('skipped');
    expect(calls).not.toContain('phase2');
    expect(calls).not.toContain('phase3');
  }, 60_000);

  // (4) Phase 2 soft-fail — output_json: null.
  it('Q15 (4) — Phase 2 soft-fails (null) → workflow continues with empty Phase 2 summary', async () => {
    const calls: string[] = [];
    const overrides: Overrides = {
      runPhase2RemSleep: async () => {
        calls.push('phase2');
        return { output_json: null };
      },
      runPhase3DeepSleep: async (inp) => {
        calls.push('phase3');
        // verify the empty phase2_summary made it through
        expect(inp.phase2_summary).toBe('');
        return {
          consolidation_json: {
            memory_md: 'm',
            daily_summary: 'd',
            stats: {},
            vault_updates: { decisions: [], projects: [], patterns: [], templates: [], concepts: [], connections: [], lessons: [], topics: [] },
          },
          messages_json: [],
          usage_input_tokens: null,
          usage_output_tokens: null,
          usage_total_tokens: null,
          usage_tool_calls: null,
        };
      },
    };
    const result = await runWorkflow(buildActivities(overrides, calls));
    expect(result.status).toBe('completed');
    expect(calls).toContain('phase2');
    expect(calls).toContain('phase3');
  }, 60_000);

  // (5) Health check 0 issues → Health Fix skipped.
  it('Q15 (5) — Health Check finds 0 issues → Health Fix is NOT called', async () => {
    const calls: string[] = [];
    await runWorkflow(buildActivities({}, calls));
    expect(calls).toContain('healthCheck');
    expect(calls).not.toContain('healthFix');
  }, 60_000);

  // (6) Health Fix returns 'incomplete' → outcome partial.
  it("Q15 (6) — Health Fix returns 'incomplete' → status=partial", async () => {
    const calls: string[] = [];
    const markCalls: MarkDeepDreamOutcomeInput[] = [];
    const overrides: Overrides = {
      runHealthCheck: async () => ({ report_json: {}, total_issues: 5 }),
      runHealthFix: async () => {
        calls.push('healthFix');
        return { status: 'incomplete', report_json: {}, total_issues_remaining: 3 };
      },
      markDeepDreamOutcome: async (inp) => {
        markCalls.push(inp);
        calls.push('markOutcome');
      },
    };
    const result = await runWorkflow(buildActivities(overrides, calls));
    expect(result.status).toBe('partial');
    expect(markCalls[0]!.outcome).toBe('partial');
  }, 60_000);

  // (7) Health Fix returns 'fixed' → outcome completed.
  it("Q15 (7) — Health Fix returns 'fixed' → status=completed", async () => {
    const overrides: Overrides = {
      runHealthCheck: async () => ({ report_json: {}, total_issues: 1 }),
      runHealthFix: async () => ({ status: 'fixed', report_json: {}, total_issues_remaining: 0 }),
    };
    const result = await runWorkflow(buildActivities(overrides));
    expect(result.status).toBe('completed');
  }, 60_000);

  // (8) write_result.files_modified empty → commitAndPr skipped.
  it('Q15 (8) — empty files_modified → commitAndPr is NOT called; pr_url is null', async () => {
    const calls: string[] = [];
    const overrides: Overrides = {
      writeFiles: async () => ({ files_modified: [], vault_writes: [] }),
    };
    const result = await runWorkflow(buildActivities(overrides, calls));
    expect(calls).not.toContain('commit');
    expect(result.pr_url).toBeNull();
    expect(result.status).toBe('completed');
  }, 60_000);

  // (9) Retry exhaustion propagates (except Phase 2). Use a non-Phase-2 activity.
  it('Q15 (9) — gatherInputs failure propagates after retries (workflow throws)', async () => {
    const overrides: Overrides = {
      gatherInputs: async () => {
        throw new Error('boom');
      },
    };
    await expect(runWorkflow(buildActivities(overrides))).rejects.toThrow();
  }, 60_000);

  // (10) Health Fix iteration carries messageHistory across.
  it('Q15 (10) — Health Fix sees messages_json from Phase 3', async () => {
    let capturedHistory: Array<Record<string, unknown>> | null = null;
    const phase3Messages = [{ role: 'user', content: 'phase3 user msg' }];
    const overrides: Overrides = {
      runPhase3DeepSleep: async () => ({
        consolidation_json: {
          memory_md: 'm',
          daily_summary: 'd',
          stats: {},
          vault_updates: { decisions: [], projects: [], patterns: [], templates: [], concepts: [], connections: [], lessons: [], topics: [] },
        },
        messages_json: phase3Messages,
        usage_input_tokens: null,
        usage_output_tokens: null,
        usage_total_tokens: null,
        usage_tool_calls: null,
      }),
      runHealthCheck: async () => ({ report_json: {}, total_issues: 1 }),
      runHealthFix: async (inp) => {
        capturedHistory = inp.consolidation_messages_json;
        return { status: 'clean', report_json: {}, total_issues_remaining: 0 };
      },
    };
    await runWorkflow(buildActivities(overrides));
    expect(capturedHistory).toEqual(phase3Messages);
  }, 60_000);

  // (11) markDeepDreamOutcome called even on 'skipped'.
  it("Q15 (11) — markDeepDreamOutcome is called with outcome='skipped' on skip-guard", async () => {
    const markCalls: MarkDeepDreamOutcomeInput[] = [];
    const overrides: Overrides = {
      gatherInputs: async () => ({ dream_id: 999, memu_memories: [], memory_md: '', daily_log: '', soul_md: '', source_date_iso: '2026-05-07' }),
      markDeepDreamOutcome: async (inp) => {
        markCalls.push(inp);
      },
    };
    await runWorkflow(buildActivities(overrides));
    expect(markCalls).toHaveLength(1);
    expect(markCalls[0]!.outcome).toBe('skipped');
  }, 60_000);

  // (12) alignMemu always called (no idempotency short-circuit at workflow level).
  it('Q15 (12) — alignMemu is always called after Phase 3 succeeds', async () => {
    const calls: string[] = [];
    await runWorkflow(buildActivities({}, calls));
    expect(calls).toContain('alignMemu');
  }, 60_000);
});
