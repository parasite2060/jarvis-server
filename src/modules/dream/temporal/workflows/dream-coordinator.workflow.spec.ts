/**
 * Unit spec for `dreamCoordinatorWorkflow` (Story 13.9).
 *
 * Q9 binding: AC #13 calls for `TestWorkflowEnvironment` coverage; the
 * five behavioural scenarios (single-execution, FIFO, failed-child-no-block,
 * missing-payload-key, idempotent-coordinator) are exercised end-to-end at
 * `test/temporal-coordinator.integration-spec.ts` against the in-process
 * Test Server (Q9 sub-decision: `createLocal()` for both unit + integration
 * because TimeSkipping in @temporalio/testing 1.17 still spawns a Java
 * test server, so the runtime cost is comparable AND createLocal matches
 * Story 13.8's pattern).
 *
 * This spec covers the workflow file's pure-logic branches via direct
 * module mocking of `@temporalio/workflow`:
 *   - Signal handler registration shape (AC #4) — handlers are bound to
 *     the three signal definitions and synchronously mutate the queue.
 *   - Dispatch helper FIFO + KIND_CONFIG correctness (AC #5, #6) — given a
 *     queue with mixed signals, executeChild is called with the right
 *     PascalCase wire types AND child IDs.
 *   - Missing-payload-key error path (AC #6) — throws with the expected
 *     message; the swallow happens in the main loop so the error is
 *     observable when we exercise the dispatch helper directly.
 *
 * The workflow's infinite `while (true)` loop is exercised in the
 * integration spec where a real Test Server drives the loop iterations.
 * Here we drive the loop ourselves by hand-feeding the queue and invoking
 * the dispatch helper via the public signal handlers + a one-shot
 * condition-resolved promise.
 */
import { dreamCoordinatorWorkflow, submitDeepSignal, submitLightSignal, submitWeeklySignal } from './dream-coordinator.workflow';

interface SignalDefStub {
  type: 'signal';
  name: string;
}

type SignalHandlerFn = (payload: Record<string, unknown>) => void;

const signalHandlers = new Map<string, SignalHandlerFn>();
const executeChildCalls: Array<{ workflowType: string; opts: unknown }> = [];
let conditionResolver: (() => void) | null = null;
let executeChildBehaviour: (workflowType: string) => Promise<void> = async () => undefined;

jest.mock('@temporalio/workflow', () => ({
  __esModule: true,
  defineSignal: jest.fn((name: string): SignalDefStub => ({ type: 'signal', name })),
  setHandler: jest.fn((def: SignalDefStub, handler: SignalHandlerFn) => {
    signalHandlers.set(def.name, handler);
  }),
  condition: jest.fn(
    () =>
      new Promise<void>((resolve) => {
        conditionResolver = resolve;
      }),
  ),
  executeChild: jest.fn(async (workflowType: string, opts: unknown) => {
    executeChildCalls.push({ workflowType, opts });
    await executeChildBehaviour(workflowType);
  }),
  workflowInfo: jest.fn(() => ({ taskQueue: 'jarvis-dream-test' })),
}));

describe('dreamCoordinatorWorkflow (unit, mocked @temporalio/workflow)', () => {
  beforeEach(() => {
    signalHandlers.clear();
    executeChildCalls.length = 0;
    conditionResolver = null;
    executeChildBehaviour = async () => undefined;
  });

  it('registers handlers for submit_light, submit_deep, submit_weekly signals (AC #4)', async () => {
    // Arrange + Act — start the workflow, allow handlers to register, then stop the loop
    const runPromise = dreamCoordinatorWorkflow();
    await Promise.resolve();

    // Assert — three handlers bound to the right wire names
    expect(signalHandlers.size).toBe(3);
    expect(signalHandlers.get('submit_light')).toBeInstanceOf(Function);
    expect(signalHandlers.get('submit_deep')).toBeInstanceOf(Function);
    expect(signalHandlers.get('submit_weekly')).toBeInstanceOf(Function);

    // Cleanup: cancel the never-resolving condition by leaving the promise hanging.
    // Jest will not await the runPromise; we silence it explicitly.
    runPromise.catch(() => undefined);
  });

  it('exports signal definitions with the FROZEN wire names (MC3)', () => {
    // Assert — Q8 binding: signal defs exported, and their wire names match
    // Story 13.8 `signalCoordinator(kind, payload)` `submit_${kind}` mapping.
    expect(submitLightSignal).toEqual({ type: 'signal', name: 'submit_light' });
    expect(submitDeepSignal).toEqual({ type: 'signal', name: 'submit_deep' });
    expect(submitWeeklySignal).toEqual({ type: 'signal', name: 'submit_weekly' });
  });

  it('dispatches a queued light signal to executeChild with the right child workflow type + ID (AC #5, #6)', async () => {
    // Arrange — start workflow, signal a light request, then unblock condition
    const runPromise = dreamCoordinatorWorkflow();
    await Promise.resolve();
    signalHandlers.get('submit_light')!({ session_id: 's1', transcript_id: 't1' });
    conditionResolver?.();
    // Let the loop body run one iteration. The next condition() call blocks again.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    // Assert — executeChild called with PascalCase wire type + light-${session_id} child ID
    expect(executeChildCalls).toHaveLength(1);
    expect(executeChildCalls[0]).toEqual({
      workflowType: 'LightDream',
      opts: {
        workflowId: 'light-s1',
        taskQueue: 'jarvis-dream-test',
        args: [{ session_id: 's1', transcript_id: 't1' }],
      },
    });

    runPromise.catch(() => undefined);
  });

  it('preserves FIFO order across mixed-kind signals (AC #5)', async () => {
    // Arrange — three mixed signals queued before the loop unblocks
    const runPromise = dreamCoordinatorWorkflow();
    await Promise.resolve();
    signalHandlers.get('submit_light')!({ session_id: 'c1' });
    signalHandlers.get('submit_deep')!({ target_date: '2026-05-08' });
    signalHandlers.get('submit_weekly')!({ week_start: '2026-W18' });

    // Act — drain queue across three iterations
    for (let i = 0; i < 3; i++) {
      conditionResolver?.();
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
    }

    // Assert — three executeChild calls in submission order
    expect(executeChildCalls.map((c) => c.workflowType)).toEqual(['LightDream', 'DeepDream', 'WeeklyReview']);
    expect(executeChildCalls.map((c) => (c.opts as { workflowId: string }).workflowId)).toEqual(['light-c1', 'deep-2026-05-08', 'weekly-2026-W18']);

    runPromise.catch(() => undefined);
  });

  it('swallows child workflow failures and continues to the next iteration (AC #5, #6)', async () => {
    // Arrange — first child throws, second child succeeds
    let callIdx = 0;
    executeChildBehaviour = async () => {
      callIdx++;
      if (callIdx === 1) throw new Error('child workflow blew up');
    };
    const runPromise = dreamCoordinatorWorkflow();
    await Promise.resolve();
    signalHandlers.get('submit_light')!({ session_id: 's-fail' });
    signalHandlers.get('submit_deep')!({ target_date: '2026-05-09' });

    // Act — drain queue; first iteration throws (swallowed), second succeeds
    for (let i = 0; i < 2; i++) {
      conditionResolver?.();
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
    }

    // Assert — both executeChild calls happened despite the first failure
    expect(executeChildCalls).toHaveLength(2);
    expect(executeChildCalls[0]?.workflowType).toBe('LightDream');
    expect(executeChildCalls[1]?.workflowType).toBe('DeepDream');

    runPromise.catch(() => undefined);
  });

  it('swallows missing-payload-key errors per single-active-dream policy (AC #6)', async () => {
    // Arrange — light signal with missing session_id
    const runPromise = dreamCoordinatorWorkflow();
    await Promise.resolve();
    signalHandlers.get('submit_light')!({}); // missing session_id
    signalHandlers.get('submit_deep')!({ target_date: '2026-05-10' });

    // Act — drain two iterations
    for (let i = 0; i < 2; i++) {
      conditionResolver?.();
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
    }

    // Assert — only the deep dream's executeChild fired; the malformed
    // light request never reached executeChild because the helper threw
    // before invoking it.
    expect(executeChildCalls).toHaveLength(1);
    expect(executeChildCalls[0]?.workflowType).toBe('DeepDream');

    runPromise.catch(() => undefined);
  });

  it('swallows non-string payload key errors (AC #6)', async () => {
    // Arrange — deep signal with target_date as a number, not a string
    const runPromise = dreamCoordinatorWorkflow();
    await Promise.resolve();
    signalHandlers.get('submit_deep')!({ target_date: 12345 });
    signalHandlers.get('submit_weekly')!({ week_start: '2026-W19' });

    // Act
    for (let i = 0; i < 2; i++) {
      conditionResolver?.();
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
    }

    // Assert — only the weekly dream dispatched; the malformed deep request swallowed
    expect(executeChildCalls).toHaveLength(1);
    expect(executeChildCalls[0]?.workflowType).toBe('WeeklyReview');

    runPromise.catch(() => undefined);
  });
});
