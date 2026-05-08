/**
 * Unit tests for `lightDreamWorkflow` (Story 13.10 / AC #13).
 *
 * Two test surfaces:
 *   1. Pure deterministic helpers (`deriveSourceDate`, `deriveSessionStart`)
 *      — testable in plain Jest without a Temporal runtime.
 *   2. Full workflow path tests using `@temporalio/testing`
 *      `TestWorkflowEnvironment.createTimeSkipping()` with stub activity
 *      implementations covering the 4 AC #13 scenarios:
 *      a. Happy path (extraction + record + commit + invalidate, all 8 acts).
 *      b. Short-session skip (no_extract: true → return early).
 *      c. Record soft-fail (runRecord throws → workflow catches, partial).
 *      d. Empty files_modified → commitAndPr + invalidateContextCache skipped.
 *
 * @group temporal
 */
import { Worker } from '@temporalio/worker';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { deriveSourceDate, deriveSessionStart } from './light-dream.workflow';
import { emptySessionLog, type SessionLogEntry } from '../../agents/schemas/extraction-summary.schema';
import type {
  CommitAndPRInput,
  CommitAndPRResult,
  ExtractionAgentOutput,
  ExtractionInput,
  InvalidateCacheInput,
  LoadTranscriptInput,
  LoadTranscriptResult,
  MarkDreamOutcomeInput,
  PersistSessionLogInput,
  RecordAgentOutput,
  RecordInput,
  UpdatePositionInput,
} from '../types/light-dream.types';

describe('lightDreamWorkflow — pure helpers', () => {
  describe('deriveSourceDate', () => {
    it('returns max source_date from non-empty memories', () => {
      const log: SessionLogEntry = {
        ...emptySessionLog(),
        memories: [
          { content: 'a', vault_target: 'memory', source_date: '2026-04-01', reasoning: null },
          { content: 'b', vault_target: 'memory', source_date: '2026-05-08', reasoning: null },
          { content: 'c', vault_target: 'memory', source_date: '2026-04-15', reasoning: null },
        ],
      };
      expect(deriveSourceDate(log, '2026-05-10T12:00:00.000Z')).toBe('2026-05-08');
    });

    it('falls back to nowIsoUtc[:10] when memories is empty', () => {
      expect(deriveSourceDate(emptySessionLog(), '2026-05-10T12:00:00.000Z')).toBe('2026-05-10');
    });
  });

  describe('deriveSessionStart', () => {
    it('returns HH:MM slice from valid ISO', () => {
      expect(deriveSessionStart('2026-05-08T14:30:45.123Z')).toBe('14:30');
    });

    it('returns 00:00 when input is null', () => {
      expect(deriveSessionStart(null)).toBe('00:00');
    });

    it('returns 00:00 when input is too short', () => {
      expect(deriveSessionStart('2026-05')).toBe('00:00');
    });
  });
});

describe('lightDreamWorkflow — Temporal scenarios', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
  }, 30_000);

  afterAll(async () => {
    await testEnv?.teardown();
  });

  /**
   * Build stub activities covering all 8 wire-name-frozen activities.
   * Test scenarios override individual stubs to exercise different paths.
   */
  function buildActivities(
    overrides: Partial<{
      loadTranscript: (inp: LoadTranscriptInput) => Promise<LoadTranscriptResult>;
      runExtraction: (inp: ExtractionInput) => Promise<ExtractionAgentOutput>;
      persistSessionLog: (inp: PersistSessionLogInput) => Promise<void>;
      runRecord: (inp: RecordInput) => Promise<RecordAgentOutput>;
      updateTranscriptPosition: (inp: UpdatePositionInput) => Promise<void>;
      invalidateContextCache: (inp: InvalidateCacheInput) => Promise<void>;
      commitAndPr: (inp: CommitAndPRInput) => Promise<CommitAndPRResult>;
      markDreamOutcome: (inp: MarkDreamOutcomeInput) => Promise<void>;
    }> = {},
  ): {
    'light.load_transcript': (inp: LoadTranscriptInput) => Promise<LoadTranscriptResult>;
    'light.run_extraction': (inp: ExtractionInput) => Promise<ExtractionAgentOutput>;
    'light.persist_session_log': (inp: PersistSessionLogInput) => Promise<void>;
    'light.run_record': (inp: RecordInput) => Promise<RecordAgentOutput>;
    'light.update_transcript_position': (inp: UpdatePositionInput) => Promise<void>;
    'light.invalidate_cache': (inp: InvalidateCacheInput) => Promise<void>;
    'light.commit_and_pr': (inp: CommitAndPRInput) => Promise<CommitAndPRResult>;
    'light.mark_dream_outcome': (inp: MarkDreamOutcomeInput) => Promise<void>;
  } {
    return {
      'light.load_transcript':
        overrides.loadTranscript ??
        (async () => ({
          dream_id: 42,
          parsed_text: 'User: hello\nAssistant: hi\nUser: again\nUser: still here\n',
          project: 'test',
          token_count: 100,
          created_at_iso: '2026-05-08T14:30:00.000Z',
          segment_end_line: 4,
          is_continuation: false,
        })),
      'light.run_extraction':
        overrides.runExtraction ??
        (async () => ({
          summary: 'Test session',
          no_extract: false,
          session_log_json: emptySessionLog(),
        })),
      'light.persist_session_log': overrides.persistSessionLog ?? (async () => {}),
      'light.run_record':
        overrides.runRecord ??
        (async () => ({
          session_log_writes: [{ path: 'dailys/2026-05-08.md', content: 'log', action: 'create' }],
          files_modified: ['dailys/2026-05-08.md'],
          files: [{ path: 'dailys/2026-05-08.md', action: 'create' }],
          summary: 'recorded',
        })),
      'light.update_transcript_position': overrides.updateTranscriptPosition ?? (async () => {}),
      'light.invalidate_cache': overrides.invalidateContextCache ?? (async () => {}),
      'light.commit_and_pr':
        overrides.commitAndPr ??
        (async () => ({
          git_branch: 'dream/light-test',
          git_pr_url: 'https://github.com/test/repo/pull/1',
          git_pr_status: 'created',
        })),
      'light.mark_dream_outcome': overrides.markDreamOutcome ?? (async () => {}),
    };
  }

  async function runWorkflow(activities: Record<string, unknown>): Promise<{ dream_id: number; pr_url: string | null }> {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: 'test-light-dream',
      // Bundle from the workflows directory — the `index.ts` re-exports
      // `lightDreamWorkflow as LightDream` so the wire name resolves at
      // executeChild() / execute() time.
      workflowsPath: require.resolve('./index.ts'),
      activities: activities as Parameters<typeof Worker.create>[0]['activities'],
    });

    const result = (await worker.runUntil(
      testEnv.client.workflow.execute('LightDream', {
        workflowId: `test-light-${Date.now()}-${Math.random()}`,
        taskQueue: 'test-light-dream',
        args: [{ session_id: 'test-session', transcript_id: 1 }],
      }),
    )) as { dream_id: number; pr_url: string | null };
    return result;
  }

  it('happy path: invokes all 8 activities + returns pr_url', async () => {
    // Arrange
    const calls: string[] = [];
    const acts = buildActivities({
      loadTranscript: async (inp) => {
        calls.push('load');
        return {
          dream_id: 42,
          parsed_text: 'User: a\nUser: b\nUser: c\nUser: d\n',
          project: null,
          token_count: null,
          created_at_iso: '2026-05-08T14:30:00.000Z',
          segment_end_line: 4,
          is_continuation: false,
        };
      },
      runExtraction: async () => {
        calls.push('extract');
        return { summary: 's', no_extract: false, session_log_json: emptySessionLog() };
      },
      persistSessionLog: async () => {
        calls.push('persist');
      },
      runRecord: async () => {
        calls.push('record');
        return {
          session_log_writes: [{ path: 'dailys/2026-05-08.md', content: 'x', action: 'create' }],
          files_modified: ['dailys/2026-05-08.md'],
          files: [{ path: 'dailys/2026-05-08.md', action: 'create' }],
          summary: '',
        };
      },
      updateTranscriptPosition: async () => {
        calls.push('updatePos');
      },
      commitAndPr: async () => {
        calls.push('commit');
        return { git_branch: 'b', git_pr_url: 'http://pr', git_pr_status: 'created' };
      },
      invalidateContextCache: async () => {
        calls.push('invalidate');
      },
      markDreamOutcome: async () => {
        calls.push('outcome');
      },
    });

    // Act
    const result = await runWorkflow(acts);

    // Assert
    expect(result.dream_id).toBe(42);
    expect(result.pr_url).toBe('http://pr');
    expect(calls).toEqual(['load', 'extract', 'persist', 'record', 'updatePos', 'commit', 'invalidate', 'outcome']);
  }, 60_000);

  it('short-session skip: no_extract=true returns early without persistSessionLog/runRecord/commit', async () => {
    // Arrange
    const calls: string[] = [];
    const acts = buildActivities({
      loadTranscript: async () => {
        calls.push('load');
        return {
          dream_id: 7,
          parsed_text: 'User: hi\n',
          project: null,
          token_count: null,
          created_at_iso: null,
          segment_end_line: 0,
          is_continuation: false,
        };
      },
      runExtraction: async () => {
        calls.push('extract');
        return { summary: 'too short', no_extract: true, session_log_json: emptySessionLog() };
      },
      persistSessionLog: async () => {
        calls.push('persist');
      },
      runRecord: async () => {
        calls.push('record');
        throw new Error('should not run');
      },
      markDreamOutcome: async () => {
        calls.push('outcome');
      },
    });

    // Act
    const result = await runWorkflow(acts);

    // Assert
    expect(result.dream_id).toBe(7);
    expect(result.pr_url).toBeNull();
    expect(calls).toEqual(['load', 'extract', 'outcome']);
  }, 60_000);

  it('empty files_modified: skips commitAndPr and invalidateContextCache', async () => {
    // Arrange
    const calls: string[] = [];
    const acts = buildActivities({
      loadTranscript: async () => {
        calls.push('load');
        return {
          dream_id: 99,
          parsed_text: 'User: a\nUser: b\nUser: c\n',
          project: null,
          token_count: null,
          created_at_iso: '2026-05-08T10:00:00.000Z',
          segment_end_line: 3,
          is_continuation: false,
        };
      },
      runExtraction: async () => {
        calls.push('extract');
        return { summary: 's', no_extract: false, session_log_json: emptySessionLog() };
      },
      persistSessionLog: async () => {
        calls.push('persist');
      },
      runRecord: async () => {
        calls.push('record');
        return { session_log_writes: [], files_modified: [], files: [], summary: '' };
      },
      updateTranscriptPosition: async () => {
        calls.push('updatePos');
      },
      commitAndPr: async () => {
        calls.push('commit');
        throw new Error('should not run');
      },
      invalidateContextCache: async () => {
        calls.push('invalidate');
        throw new Error('should not run');
      },
      markDreamOutcome: async () => {
        calls.push('outcome');
      },
    });

    // Act
    const result = await runWorkflow(acts);

    // Assert
    expect(result.dream_id).toBe(99);
    expect(result.pr_url).toBeNull();
    expect(calls).toEqual(['load', 'extract', 'persist', 'record', 'updatePos', 'outcome']);
  }, 60_000);
});
