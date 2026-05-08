/**
 * Test workflow bundle for Story 13.9 — the real `dreamCoordinatorWorkflow`
 * + stub child workflows (`LightDream` / `DeepDream` / `WeeklyReview`)
 * registered under the PascalCase wire names per Q5 binding + a `recorder`
 * workflow that captures execution metadata for assertions.
 *
 * Workflow code is sandboxed — only `@temporalio/workflow` imports allowed.
 * `Date.now()` IS legal inside TS workflow code: the SDK patches the global
 * `Date` constructor + `Date.now` to be replay-deterministic.
 *
 * The Worker's `Worker.create({ workflows: ... })` API does NOT accept a
 * map override — registration is bundle-based via `workflowsPath`. So this
 * file IS the bundle entry: it re-exports the real coordinator alongside
 * the test stubs. Tests register ALL of these by pointing the Worker at
 * this file's directory.
 */
import * as wf from '@temporalio/workflow';

export {
  dreamCoordinatorWorkflow,
  submitLightSignal,
  submitDeepSignal,
  submitWeeklySignal,
} from '../../../../src/modules/dream/temporal/workflows/dream-coordinator.workflow';

export interface ChildExecutionRecord {
  kind: 'light' | 'deep' | 'weekly';
  workflowId: string;
  payload: Record<string, unknown>;
  startMs: number;
  endMs: number;
  threw: boolean;
}

export const recordChildSignal = wf.defineSignal<[ChildExecutionRecord]>('recordChild');
export const getRecordsQuery = wf.defineQuery<ChildExecutionRecord[]>('getRecords');

const RECORDER_WORKFLOW_ID = 'test-recorder-singleton';

/**
 * Sidecar workflow that accumulates child execution records across the
 * full test scenario. Tests start it before signalling the coordinator,
 * then query its `getRecords` handle for assertions.
 */
export async function recorderWorkflow(): Promise<void> {
  const records: ChildExecutionRecord[] = [];
  wf.setHandler(recordChildSignal, (rec) => {
    records.push(rec);
  });
  wf.setHandler(getRecordsQuery, () => records);
  // Block forever — the test terminates this workflow when done.
  await wf.condition(() => false);
}

const CHILD_DURATION_MS = 200;

async function recordExecution(rec: ChildExecutionRecord): Promise<void> {
  const handle = wf.getExternalWorkflowHandle(RECORDER_WORKFLOW_ID);
  await handle.signal(recordChildSignal, rec);
}

export async function LightDream(payload: Record<string, unknown>): Promise<void> {
  const startMs = Date.now();
  // Test-only failure marker — payload-driven so we don't need cross-workflow
  // mutable state in the fixture (matches the failed-child scenario).
  const shouldThrow = payload['_shouldThrow'] === true;
  await wf.sleep(CHILD_DURATION_MS);
  const endMs = Date.now();
  await recordExecution({
    kind: 'light',
    workflowId: wf.workflowInfo().workflowId,
    payload,
    startMs,
    endMs,
    threw: shouldThrow,
  });
  if (shouldThrow) {
    // ApplicationFailure (non-retryable) terminates this workflow run with a
    // failed status, which propagates to the coordinator's `executeChild`
    // await as a thrown error — exactly the scenario we need. Throwing a
    // plain Error would be a Workflow Task failure (replayable forever).
    throw wf.ApplicationFailure.nonRetryable('LightDream stub: deliberate failure for failed-child-does-not-block scenario', 'LightDreamStubFailure');
  }
}

export async function DeepDream(payload: Record<string, unknown>): Promise<void> {
  const startMs = Date.now();
  await wf.sleep(CHILD_DURATION_MS);
  const endMs = Date.now();
  await recordExecution({
    kind: 'deep',
    workflowId: wf.workflowInfo().workflowId,
    payload,
    startMs,
    endMs,
    threw: false,
  });
}

export async function WeeklyReview(payload: Record<string, unknown>): Promise<void> {
  const startMs = Date.now();
  await wf.sleep(CHILD_DURATION_MS);
  const endMs = Date.now();
  await recordExecution({
    kind: 'weekly',
    workflowId: wf.workflowInfo().workflowId,
    payload,
    startMs,
    endMs,
    threw: false,
  });
}
