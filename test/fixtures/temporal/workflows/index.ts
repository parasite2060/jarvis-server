/**
 * Test-only workflow fixtures for `temporal-bootstrap.integration-spec.ts`
 * (Story 13.8). Workflow code is sandboxed by the Temporal SDK — no Node.js
 * APIs allowed, only `@temporalio/workflow` imports.
 *
 * `runNoopWorkflow` exercises the activity-execution path against the real
 * test server: the worker resolves the `test.noop` activity from the
 * NestJS-wired registry and calls it once.
 *
 * `runSignalAccumulatorWorkflow` accumulates `submit_light` signal payloads
 * onto an in-memory array exposed via a query handler — used by scenario
 * (b) to verify that snake_case payload keys round-trip end-to-end through
 * the wire.
 */
import * as wf from '@temporalio/workflow';

const { 'test.noop': testNoop } = wf.proxyActivities<{ 'test.noop': () => Promise<string> }>({
  startToCloseTimeout: '10 seconds',
});

export async function runNoopWorkflow(): Promise<string> {
  return testNoop();
}

export const submitLightSignal = wf.defineSignal<[Record<string, unknown>]>('submit_light');
export const getSignalPayloadsQuery = wf.defineQuery<Array<Record<string, unknown>>>('getSignalPayloads');

export async function runSignalAccumulatorWorkflow(): Promise<void> {
  const payloads: Array<Record<string, unknown>> = [];
  wf.setHandler(submitLightSignal, (payload) => {
    payloads.push(payload);
  });
  wf.setHandler(getSignalPayloadsQuery, () => payloads);
  // Block forever — the workflow stays alive until the test terminates it.
  await wf.condition(() => false);
}
