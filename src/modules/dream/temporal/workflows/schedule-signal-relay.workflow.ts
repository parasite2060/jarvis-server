/**
 * scheduleSignalRelayWorkflow — Story 13.13.
 *
 * Sandbox-clean relay workflow started by Temporal Schedules. Computes the
 * fire date via `workflow.now()` (deterministic Temporal primitive) and
 * signals the DreamCoordinator singleton with `submit_deep` or
 * `submit_weekly`.
 *
 * Wire name `ScheduleSignalRelay` (FROZEN per MC3 + Python
 * `@workflow.defn(name="ScheduleSignalRelay")` at
 * `app/workflows/schedule_relay.py:29`). Registered via aliased re-export in
 * `workflows/index.ts`.
 *
 * # DETERMINISM RULES — Temporal replays this workflow code on recovery.
 * Forbidden in this module: `Date.now()`, `Math.random()`,
 * `crypto.randomUUID()`, file/network I/O, env reads.
 * Allowed deterministic primitives: `workflow.now()`, `workflow.uuid4()`,
 * `workflow.sleep()`, `workflow.condition()`, `getExternalWorkflowHandle`,
 * signals.
 *
 * Mirrors Python `app/workflows/schedule_relay.py:1-55` byte-for-byte modulo
 * TS syntax + the Q8 weekday-conversion fix (Python `weekday()` Mon=0..Sun=6
 * vs JS `getUTCDay()` Sun=0..Sat=6).
 */
import * as workflow from '@temporalio/workflow';

export type ScheduleRelayKind = 'deep' | 'weekly';

/**
 * Compute the ISO Monday of the week containing `date`. Pure deterministic
 * helper. Mirrors Python `_iso_monday()` at
 * `app/workflows/schedule_relay.py:23-26`.
 *
 * Q8 (RESOLVED 2026-05-09): Python uses `date.weekday()` (Mon=0..Sun=6); JS
 * `getUTCDay()` returns Sun=0..Sat=6. Conversion `(jsDow + 6) % 7` produces
 * Python's weekday convention.
 *   Sample mappings:
 *     Sat (JS=6, Py=5) → (6+6)%7 = 5
 *     Sun (JS=0, Py=6) → (0+6)%7 = 6
 *     Mon (JS=1, Py=0) → (1+6)%7 = 0
 */
export function _isoMonday(date: Date): string {
  const jsDow = date.getUTCDay(); // Sun=0..Sat=6
  const pyWeekday = (jsDow + 6) % 7; // Mon=0..Sun=6
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - pyWeekday));
  return monday.toISOString().slice(0, 10); // YYYY-MM-DD
}

export async function scheduleSignalRelayWorkflow(kind: ScheduleRelayKind): Promise<void> {
  // SDK 1.17 contract: `new Date()` and `Date.now()` ARE replay-safe inside
  // workflow code (set on first invocation, stay constant during replay per
  // `node_modules/@temporalio/workflow/lib/global-overrides.js:43-47`).
  // `workflow.now()` is NOT exported in this SDK version (Story 13.10
  // Finding 3 leader-reversed). Use `new Date()` directly.
  const fireDate = new Date();
  const fireDateIso = fireDate.toISOString().slice(0, 10);

  let payload: Record<string, unknown>;
  let signalName: 'submit_deep' | 'submit_weekly';

  if (kind === 'deep') {
    // snake_case keys preserved (MC3) — mirrors Python `schedule_relay.py:42-45`.
    payload = {
      trigger: 'auto',
      target_date: fireDateIso,
    };
    signalName = 'submit_deep';
  } else {
    payload = {
      trigger: 'auto',
      week_start: _isoMonday(fireDate),
    };
    signalName = 'submit_weekly';
  }

  await workflow.getExternalWorkflowHandle('coord-singleton').signal(signalName, payload);
}
