/**
 * DreamCoordinatorWorkflow — TS port of `app/workflows/coordinator.py` (Story 13.9).
 *
 * # DETERMINISM RULES — Temporal replays this workflow code on recovery.
 *   Any non-deterministic call breaks replay. Forbidden in this module:
 *     - `Date.now()`, `new Date()`, `performance.now()`
 *     - `Math.random()`, `crypto.randomUUID()`
 *     - `setTimeout`, `setInterval`
 *     - file I/O, network I/O, DB queries
 *     - direct env reads (the `env` namespace on `process`), `process.argv`
 *   Allowed deterministic primitives (from `@temporalio/workflow`):
 *     - `condition()`, `executeChild()`, `workflowInfo()`
 *     - `defineSignal()` + `setHandler()`
 *     - pure data manipulation
 *
 * # SINGLE-ACTIVE-DREAM INVARIANT
 *   At most one dream workflow runs at any wall-clock instant.
 *   Proof:
 *     1. There is exactly one DreamCoordinatorWorkflow with workflow ID
 *        "coord-singleton". `WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY`
 *        prevents creation of a second.
 *     2. The coordinator's loop is the only consumer of the local `queue`.
 *     3. Inside the loop body, `running = true` is set BEFORE `executeChild`
 *        and `running = false` is set AFTER it returns (in a try/finally).
 *     4. `executeChild` is awaited synchronously — the next iteration cannot
 *        begin until the current child has terminated.
 *     5. Therefore, between any two consecutive iterations, the previous
 *        child has terminated. There is no point in time at which two
 *        children are mid-flight.
 *   QED. The single-active-dream invariant holds.
 *
 * # MC3 — Temporal coordinates FROZEN
 *   - Workflow type: `dreamCoordinatorWorkflow` (registered via function name).
 *   - Signal wire names: `submit_light`, `submit_deep`, `submit_weekly`.
 *   - Snake_case payload keys preserved verbatim end-to-end.
 *   - Child workflow types (PascalCase, Python parity): `LightDream`,
 *     `DeepDream`, `WeeklyReview`.
 *   - Child workflow IDs: `${kind}-${payload[idKey]}`.
 */
import { condition, defineSignal, executeChild, setHandler, workflowInfo } from '@temporalio/workflow';

export type DreamKind = 'light' | 'deep' | 'weekly';

export interface DreamRequest {
  kind: DreamKind;
  payload: Record<string, unknown>;
}

// Wire signal names FROZEN per MC3 — match Python `@workflow.signal`
// `submit_light` / `submit_deep` / `submit_weekly` AND `TemporalClientService`
// `signalCoordinator` mapping `submit_${kind}`.
export const submitLightSignal = defineSignal<[Record<string, unknown>]>('submit_light');
export const submitDeepSignal = defineSignal<[Record<string, unknown>]>('submit_deep');
export const submitWeeklySignal = defineSignal<[Record<string, unknown>]>('submit_weekly');

// Child workflow type names + payload ID keys — match Python `_KIND_CONFIG`
// (coordinator.py:41-45). PascalCase wire names per Python `@workflow.defn(name=...)`.
const KIND_CONFIG: Record<DreamKind, { workflowType: string; idKey: string }> = {
  light: { workflowType: 'LightDream', idKey: 'session_id' },
  deep: { workflowType: 'DeepDream', idKey: 'target_date' },
  weekly: { workflowType: 'WeeklyReview', idKey: 'week_start' },
};

export async function dreamCoordinatorWorkflow(): Promise<void> {
  const queue: DreamRequest[] = [];
  // `running` flag retained as a future-observability hook; the
  // single-active-dream invariant relies on the synchronous await of
  // executeChild below, NOT on this flag.
  let running = false;

  setHandler(submitLightSignal, (payload) => {
    queue.push({ kind: 'light', payload });
  });
  setHandler(submitDeepSignal, (payload) => {
    queue.push({ kind: 'deep', payload });
  });
  setHandler(submitWeeklySignal, (payload) => {
    queue.push({ kind: 'weekly', payload });
  });

  const taskQueue = workflowInfo().taskQueue;

  while (true) {
    await condition(() => queue.length > 0);
    const req = queue.shift()!;
    running = true;
    try {
      await dispatchChild(req, taskQueue);
    } catch {
      // Swallow per single-active-dream policy — a failed child workflow
      // MUST NOT block subsequent submissions. Children handle their own
      // retry/outcome semantics (Stories 13.10–13.12 own per-kind RetryPolicy).
      // Coordinator observability for failures lives in `dream_phases.outcome`
      // populated by children, NOT in coordinator logs (workflow code can't log).
    } finally {
      running = false;
    }
    // Reference `running` to keep TS `noUnusedLocals` happy without changing
    // the determinism contract — the value is observable via future query
    // handlers (out of scope for 13.9).
    void running;
  }
}

async function dispatchChild(req: DreamRequest, taskQueue: string): Promise<void> {
  const cfg = KIND_CONFIG[req.kind];
  const idValue = req.payload[cfg.idKey];
  if (typeof idValue !== 'string' || idValue.length === 0) {
    // Mirrors Python's ApplicationError on missing key. Caught by the
    // swallow above so a malformed payload doesn't block the loop.
    throw new Error(`coordinator: missing or non-string ${cfg.idKey} in ${req.kind} payload`);
  }
  const childId = `${req.kind}-${idValue}`;
  // Child workflow-level retry policy: do NOT retry the whole child workflow
  // on failure. Child workflows manage their own per-activity RetryPolicies
  // (Stories 13.10–13.12). If the child workflow itself fails (e.g. all
  // activity retries exhausted), the coordinator swallows the error and
  // moves on to the next queued signal. Retrying the child workflow here
  // would stall the coordinator loop indefinitely.
  await executeChild(cfg.workflowType, {
    workflowId: childId,
    taskQueue,
    args: [req.payload],
    retry: { maximumAttempts: 1 },
  });
}
