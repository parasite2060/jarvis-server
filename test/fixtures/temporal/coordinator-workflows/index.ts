/**
 * Stub coordinator child workflows for temporal-coordinator.integration-spec.ts
 *
 * These are minimal Temporal workflow functions used ONLY in coordinator
 * integration tests. They are NOT shipped in production.
 *
 * Architecture:
 *   - A `recorderWorkflow` runs as a long-lived singleton.  Every time a child
 *     stub executes it appends a `ChildExecutionRecord` to the recorder's log
 *     by signalling it.  The test reads the log via the `getRecords` query.
 *
 *   - Three stub child workflows (`LightDream`, `DeepDream`, `WeeklyReview`)
 *     mirror the production MC3-frozen wire names.  Each records its own
 *     execution info and optionally throws (via `_shouldThrow` in the payload).
 *
 * Design decisions:
 *   - Stub children use `executeChild` to signal the recorder rather than
 *     activities, which keeps the worker bundle self-contained (no activity
 *     registration needed for the coordinator tests).
 *   - `RECORDER_WORKFLOW_ID` is a module-level constant because the coordinator
 *     test spec creates the recorder with this fixed ID and all child stubs
 *     need to know it to signal the recorder.
 */
import { ApplicationFailure, condition, defineQuery, defineSignal, executeChild, setHandler, workflowInfo } from '@temporalio/workflow';

// ─── Exported types ──────────────────────────────────────────────────────────

export interface ChildExecutionRecord {
  kind: 'light' | 'deep' | 'weekly';
  workflowId: string;
  payload: Record<string, unknown>;
  threw: boolean;
  startMs: number;
  endMs: number;
}

// ─── Recorder workflow ───────────────────────────────────────────────────────

const RECORDER_WORKFLOW_ID = 'test-recorder-singleton';

const appendRecordSignal = defineSignal<[ChildExecutionRecord]>('appendRecord');
const getRecordsQuery = defineQuery<ChildExecutionRecord[]>('getRecords');

/**
 * Long-lived singleton recorder.  Child stubs signal it with their execution
 * records; the test reads them back via the `getRecords` query.
 */
export async function recorderWorkflow(): Promise<void> {
  const records: ChildExecutionRecord[] = [];

  setHandler(appendRecordSignal, (record) => {
    records.push(record);
  });
  setHandler(getRecordsQuery, () => records);

  // Run until terminated by the test harness
  await condition(() => false);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function runChildStub(kind: 'light' | 'deep' | 'weekly', payload: Record<string, unknown>): Promise<void> {
  const startMs = Date.now();
  const workflowId = workflowInfo().workflowId;
  let threw = false;

  try {
    if (payload['_shouldThrow']) {
      threw = true;
      throw new Error(`stub-throw requested via _shouldThrow for ${workflowId}`);
    }
  } finally {
    const endMs = Date.now();
    // Signal the recorder (best-effort — if the recorder is gone we swallow the error
    // so the child stub itself doesn't fail the coordinator invariant tests).
    await executeChild('recorderWorkflow', {
      workflowId: RECORDER_WORKFLOW_ID,
      taskQueue: workflowInfo().taskQueue,
      args: [],
      // ALLOW_DUPLICATE_FAILED_ONLY ensures we don't accidentally re-start the
      // recorder if it already exists — we want to signal the EXISTING one.
    })
      .then(() => undefined)
      .catch(() => undefined);

    // Signal by sending directly to the recorder handle via a separate child.
    // We can't import the temporal client inside workflow code, so we use a
    // dedicated "signaller" child workflow as an activity proxy.
    // Actually — in Temporal workflow code we CAN use `executeChild` with
    // a different task queue? No. Simplest correct approach: record the fact
    // by signalling the recorder workflow ID using `executeChild` of a
    // "noop signaller" workflow. But that adds complexity.
    //
    // Correct Temporal-idiomatic approach: the child stub stores its record
    // in its OWN return value, and the coordinator spec reads it from there.
    // But `executeChild` return values are the child's workflow result...
    //
    // SIMPLEST correct approach given constraints:
    // Use a dedicated `reportToRecorder` child workflow that wraps the signal.
    // OR: use `proxyActivities` to call a no-op activity and store results in
    // a workflow-level variable, then have the test poll the child's result.
    //
    // We choose the RECORDER SIGNAL approach via a tiny relay child workflow.
    await executeChild(reportRecordWorkflow, {
      workflowId: `report-${workflowId}-${startMs}`,
      taskQueue: workflowInfo().taskQueue,
      args: [
        {
          kind,
          workflowId,
          payload,
          threw,
          startMs,
          endMs,
        } satisfies ChildExecutionRecord,
      ],
    }).catch(() => undefined);
  }
}

// ─── Relay: records a child execution by signalling the recorder ─────────────

async function reportRecordWorkflow(record: ChildExecutionRecord): Promise<void> {
  // Signal the recorder singleton. `executeChild` on an already-running workflow
  // with ALLOW_DUPLICATE_FAILED_ONLY re-uses the existing run — but we want to
  // SIGNAL it, not start it. Temporal workflow code doesn't have direct handle
  // access, so we can't signal from within.
  //
  // ALTERNATIVE design: the recorder IS the parent of all child stubs — it
  // issues `executeChild` sequentially and collects return values.
  //
  // Revised approach (simpler): child stubs DON'T signal the recorder.
  // Instead they RETURN their ChildExecutionRecord as their workflow RESULT.
  // The coordinator (dreamCoordinatorWorkflow) already awaits each child;
  // the test spec queries the coordinator's result OR the test harness reads
  // child workflow results by workflow ID.
  //
  // This means: coordinator spec queries child results by ID, not a recorder.
  // Let's implement THAT approach — it avoids cross-workflow signalling entirely.
  void record; // unused in this revised approach
}

// ─── Revised design: child stubs return ChildExecutionRecord ─────────────────
// The coordinator spec's `readRecords` helper reads child workflow results
// by workflow ID from the cluster, not from a recorder workflow.
// We keep `recorderWorkflow` + `getRecords` query for backward-compat with
// the test spec's `readRecords(testClient, harness)` pattern, but the recorder
// workflow itself now collects records by receiving signals from the children.
//
// FINAL clean design:
//   1. Child stub starts → signals recorder with its record SYNCHRONOUSLY via
//      a Temporal local activity (no external I/O needed — just signal delivery).
//   2. `recorderWorkflow` accumulates via `appendRecord` signal handler.
//
// Temporal workflow code CAN signal OTHER workflows via `getExternalWorkflowHandle`.
// That's the correct API. Let's use it.

import { getExternalWorkflowHandle } from '@temporalio/workflow';

// ─── Child stub implementation (clean final version) ─────────────────────────

async function executeChildStub(kind: 'light' | 'deep' | 'weekly', payload: Record<string, unknown>): Promise<void> {
  const startMs = Date.now();
  const workflowId = workflowInfo().workflowId;
  const threw = Boolean(payload['_shouldThrow']);

  // Signal the recorder BEFORE throwing so the signal is delivered even when
  // the child workflow fails. In Temporal, exceptions thrown in workflow code
  // fail the workflow task — a `finally` block after a throw does not run
  // reliably in the sandbox. Signal first, throw after.
  const endMs = Date.now();
  const record: ChildExecutionRecord = {
    kind,
    workflowId,
    payload,
    threw,
    startMs,
    endMs,
  };

  await getExternalWorkflowHandle(RECORDER_WORKFLOW_ID)
    .signal(appendRecordSignal, record)
    .catch(() => undefined);

  if (threw) {
    // Use ApplicationFailure.nonRetryable so the workflow task does NOT get
    // retried by Temporal. A plain `throw new Error(...)` causes workflow task
    // retries (which block the coordinator loop). nonRetryable causes an
    // immediate FAILED terminal state — the coordinator's catch {} block fires
    // right away and can process the next queued signal.
    throw ApplicationFailure.nonRetryable(`stub-throw: ${workflowId}`);
  }
}

// ─── Production-parity child workflow stubs ──────────────────────────────────
// Wire names MUST match production: `LightDream`, `DeepDream`, `WeeklyReview`
// (MC3 frozen — see dream-coordinator.workflow.ts KIND_CONFIG).

/** Stub for `LightDream` child workflow. Wire name matches production MC3. */
export async function LightDream(payload: Record<string, unknown>): Promise<void> {
  await executeChildStub('light', payload);
}

/** Stub for `DeepDream` child workflow. Wire name matches production MC3. */
export async function DeepDream(payload: Record<string, unknown>): Promise<void> {
  await executeChildStub('deep', payload);
}

/** Stub for `WeeklyReview` child workflow. Wire name matches production MC3. */
export async function WeeklyReview(payload: Record<string, unknown>): Promise<void> {
  await executeChildStub('weekly', payload);
}

// Also export the coordinator workflow (used by some tests that verify the
// real coordinator runs against stub children on the same task queue)
export { dreamCoordinatorWorkflow } from '../../../../src/modules/dream/temporal/workflows/dream-coordinator.workflow';
