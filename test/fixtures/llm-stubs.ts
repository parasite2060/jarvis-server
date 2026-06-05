/**
 * Minimal valid LLM stub responses for each dream pipeline agent.
 *
 * deepagents extracts `structuredResponse` from the LLM's chat completion:
 *   result.structuredResponse = JSON.parse(choices[0].message.content)
 *
 * Each helper returns a MockStubInput ready for ApiMockHelper.register().
 * The stubs match any POST to /v1/chat/completions and have no `times` limit
 * (persist for the whole test) — callers clear stubs in afterEach/afterAll.
 */
import type { MockStubInput } from '../helpers';

function chatCompletion(content: unknown): MockStubInput {
  return {
    matchers: [
      { field: 'url', op: 'contains', value: '/chat/completions' },
      { field: 'method', op: 'exact', value: 'POST' },
    ],
    response: {
      status: 200,
      body: {
        id: 'chatcmpl-stub',
        object: 'chat.completion',
        model: 'stub',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: JSON.stringify(content) },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      },
    },
  };
}

/** Light dream — extraction agent (ExtractionSummarySchema) */
export function extractionStub(): MockStubInput {
  return chatCompletion({
    summary: 'E2E test session',
    no_extract: false,
    session_log: {
      context: 'E2E test context',
      key_exchanges: ['User asked about TypeScript. Assistant explained strict mode.'],
      decisions_made: ['Use TypeScript strict mode because it catches null errors at compile time'],
      lessons_learned: ['TypeScript strict mode prevents runtime null errors'],
      failed_lessons: [],
      action_items: [],
      concepts: [],
      connections: [],
      memories: [
        {
          content: 'Use TypeScript strict mode',
          reasoning: 'Prevents runtime null errors',
          vault_target: 'patterns',
          source_date: new Date().toISOString().slice(0, 10),
        },
      ],
    },
  });
}

/** Light dream — record agent (RecordResultSchema) */
export function recordStub(): MockStubInput {
  const today = new Date().toISOString().slice(0, 10);
  return chatCompletion({
    files: [{ path: `dailys/${today}.md`, action: 'create' }],
    summary: 'Daily log written',
  });
}

/** Deep dream — Phase 1 light sleep agent (LightSleepOutputSchema) */
export function phase1Stub(): MockStubInput {
  return chatCompletion({
    candidates: [
      {
        content: 'Use TypeScript strict mode',
        category: 'patterns',
        reinforcement_count: 1,
        contradiction_flag: false,
        source_sessions: ['e2e-test-session'],
      },
    ],
    duplicates_removed: 0,
    contradictions_found: 0,
  });
}

/** Deep dream — Phase 2 REM sleep agent (REMSleepOutputSchema) */
export function phase2Stub(): MockStubInput {
  return chatCompletion({
    themes: [{ topic: 'TypeScript best practices', session_count: 1, evidence: ['strict mode discussion'] }],
    new_connections: [],
    promotion_candidates: [],
    gaps: [],
  });
}

/** Deep dream — Phase 3 consolidation agent (ConsolidationOutputSchema) */
export function phase3Stub(): MockStubInput {
  return chatCompletion({
    memory_md: '## Strong Patterns\n- Use TypeScript strict mode (1x)\n',
    daily_summary: 'Discussed TypeScript strict mode best practices.',
    stats: {
      total_memories_processed: 1,
      duplicates_removed: 0,
      contradictions_resolved: 0,
      patterns_promoted: 0,
      stale_pruned: 0,
    },
    vault_updates: {
      decisions: [],
      projects: [],
      patterns: [],
      templates: [],
      concepts: [],
      connections: [],
      lessons: [],
      topics: [],
    },
    vault_writes: [],
  });
}

/** Deep dream — health fix agent (HealthFixOutputSchema) */
export function healthFixStub(): MockStubInput {
  return chatCompletion({
    actions: [],
    issues_resolved: 0,
    issues_skipped: 0,
    iteration: 1,
  });
}

/** Weekly review agent (WeeklyReviewOutputSchema) */
export function weeklyReviewStub(): MockStubInput {
  return chatCompletion({
    review_content: '# Weekly Review\n\nGood week of TypeScript development.',
    week_themes: ['TypeScript best practices'],
    stale_action_items: [],
    project_updates: {},
  });
}
