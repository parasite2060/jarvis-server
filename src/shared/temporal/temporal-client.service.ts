import { Injectable, Logger } from '@nestjs/common';

/**
 * Temporal coordinator-signal client (Story 13.3 stub; Story 13.8 retrofit).
 *
 * Mirrors Python's `app/temporal_client.py :: signal_coordinator(kind, payload)`
 * — the call site uses the short kind (`'light' | 'deep' | 'weekly'`); the
 * service maps to the actual `submit_${kind}` Temporal signal name internally
 * (Story 13.8 owns the `@temporalio/client` Connection + WorkflowHandle wiring;
 * 13.3 ships a logging stub so use cases can be unit-tested today).
 *
 * MC3 freezes the Temporal coordinates: namespace `jarvis`, task queue
 * `jarvis-dream`, workflow ID `coord-singleton`, signal payload schemas
 * (snake_case keys: `transcript_id`, `session_id`, `dream_id`, `date`, ...).
 * The frozen payload schema is the responsibility of CALLERS — the service
 * passes through `payload` unchanged.
 */
export type CoordinatorSignalKind = 'light' | 'deep' | 'weekly';

// Story 13.1 §AC-4 forbidden field regex (production variant): drop fields
// whose names smell like content / secrets / raw bodies. Matches only
// `(content|secret|raw|payload)` — IDs ending in `_id` (e.g. `transcript_id`)
// stay because they are not content. See `jarvis-log-event.spec.ts:139`.
const FORBIDDEN_FIELD_REGEX = /(content|secret|raw|payload)/i;

@Injectable()
export class TemporalClientService {
  private readonly logger = new Logger(TemporalClientService.name);

  async signalCoordinator(kind: CoordinatorSignalKind, payload: Record<string, unknown>): Promise<void> {
    const sanitised: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) {
      if (FORBIDDEN_FIELD_REGEX.test(k)) continue;
      sanitised[k] = v;
    }
    this.logger.log({
      message: 'temporal coordinator signal stubbed',
      event: 'temporalClient.signalCoordinator.invoked',
      kind,
      ...sanitised,
    });
  }
}
