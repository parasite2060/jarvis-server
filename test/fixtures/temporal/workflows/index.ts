/**
 * Stub workflows for temporal-bootstrap.integration-spec.ts
 *
 * These are minimal Temporal workflow functions used ONLY in integration tests.
 * They are NOT shipped in production — they live here to give the worker a
 * real `workflowsPath` bundle to compile and register.
 *
 * Two workflows needed by the bootstrap spec:
 *   - `runNoopWorkflow`         — executes the `test.noop` activity and returns its result
 *   - `runSignalAccumulatorWorkflow` — accumulates `submit_*` signal payloads;
 *                                       queryable via `getSignalPayloads`
 */
import { condition, defineQuery, defineSignal, proxyActivities, setHandler } from '@temporalio/workflow';

// ─── Activities ─────────────────────────────────────────────────────────────

// The test activity is registered via @TemporalActivity('test.noop')
// so the activity name on the wire is 'test.noop' (with the dot).
// proxyActivities keys must match the registered activity name exactly.
const activities = proxyActivities<{ 'test.noop'(): Promise<string> }>({
  startToCloseTimeout: '30 seconds',
});

// ─── runNoopWorkflow ─────────────────────────────────────────────────────────

/** Executes the `test.noop` activity once and returns its string result. */
export async function runNoopWorkflow(): Promise<string> {
  return activities['test.noop']();
}

// ─── runSignalAccumulatorWorkflow ────────────────────────────────────────────

const submitLightSignal = defineSignal<[Record<string, unknown>]>('submit_light');
const submitDeepSignal = defineSignal<[Record<string, unknown>]>('submit_deep');
const submitWeeklySignal = defineSignal<[Record<string, unknown>]>('submit_weekly');
const getSignalPayloadsQuery = defineQuery<Array<Record<string, unknown>>>('getSignalPayloads');

/**
 * Accumulates every signal payload received via `submit_light`, `submit_deep`,
 * or `submit_weekly`. The payloads are queryable via `getSignalPayloads`.
 *
 * The workflow loops indefinitely so the test can send a signal and then query
 * the result without a race against workflow completion.
 */
export async function runSignalAccumulatorWorkflow(): Promise<void> {
  const payloads: Array<Record<string, unknown>> = [];

  setHandler(submitLightSignal, (payload) => {
    payloads.push(payload);
  });
  setHandler(submitDeepSignal, (payload) => {
    payloads.push(payload);
  });
  setHandler(submitWeeklySignal, (payload) => {
    payloads.push(payload);
  });
  setHandler(getSignalPayloadsQuery, () => payloads);

  // Run until the test terminates us via `handle.terminate('test-cleanup')`
  await condition(() => false);
}
