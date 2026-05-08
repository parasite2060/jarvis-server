/**
 * Temporal client wrapper (Story 13.8 retrofit of Story 13.3 stub).
 *
 * Mirrors Python `app/temporal_client.py`:
 *   - Lazy-singleton `Connection` + `Client` (Q3 binding) — connects on first
 *     use, race-safe via memoised `Promise<Client>`. `healthy()` does NOT
 *     trigger a connection attempt.
 *   - `signalCoordinator(kind, payload)` — Story 13.3 PUBLIC SIGNATURE
 *     PRESERVED (Q4 binding). Maps to `submit_${kind}` wire signal targeting
 *     `coord-singleton`. Snake_case payload keys preserved end-to-end (MC3).
 *   - `ensureCoordinatorRunning()` — idempotent `client.workflow.start` for
 *     `coord-singleton` (Q5 functional placeholder; called by Story 13.9).
 *   - `registerSchedules()` — empty placeholder (Q5; body filled by 13.13).
 *   - `healthy()` — graceful Decision D probe via `getSystemInfo({})` with
 *     2 s timeout (Q3 + Q7).
 *   - `getRawClient()` — exposes the cached `Client` for callers that need
 *     direct workflow-start access (Q4). Worker uses its own
 *     `NativeConnection` (SDK boundary — see Implementation note in story).
 *
 * Errors thrown via `new InternalException(ErrorCode.TEMPORAL_*, message)` —
 * caller (Story 13.3 `IngestTranscriptUseCase`) catches and soft-fails.
 *
 * # Graceful shutdown — first-class invariant
 *
 * Implements `OnApplicationShutdown` (phase 3 — last). Pairs with
 * `TemporalWorkerService` which implements `BeforeApplicationShutdown`
 * (phase 2). NestJS lifecycle order is:
 *   onModuleDestroy → beforeApplicationShutdown → onApplicationShutdown
 *
 * The phase choice guarantees the worker drains its in-flight activities
 * BEFORE we close the client's gRPC channel — so any client RPCs the
 * worker's drain logic relies on stay reachable until the drain is done.
 *
 * Contract per leader's amplification (2026-05-08):
 *   - Idempotent: second call is a no-op.
 *   - Skipped path: if `clientPromise` is `null` (lazy never resolved), log
 *     `temporalClient.shutdown.skipped { reason: 'neverConnected' }`.
 *   - try/catch around `connection.close()` — log
 *     `temporalClient.shutdown.failed` at warn level on failure; clear
 *     `client = null` anyway. NEVER rethrow.
 */
import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Client, Connection, WorkflowExecutionAlreadyStartedError, WorkflowIdReusePolicy } from '@temporalio/client';
import { AppConfigService } from 'src/shared/config/config.service';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';

export type CoordinatorSignalKind = 'light' | 'deep' | 'weekly';

const COORDINATOR_WORKFLOW_ID = 'coord-singleton';
const COORDINATOR_WORKFLOW_TYPE = 'dreamCoordinatorWorkflow';
const HEALTHY_TIMEOUT_MS = 2_000;

// Story 13.1 §AC-4 forbidden field regex (production variant): drop fields
// whose names smell like content / secrets / raw bodies. Matches only
// `(content|secret|raw|payload)` — IDs ending in `_id` (e.g. `transcript_id`)
// stay because they are not content. See `jarvis-log-event.spec.ts`.
const FORBIDDEN_FIELD_REGEX = /(content|secret|raw|payload)/i;

@Injectable()
export class TemporalClientService implements OnApplicationShutdown {
  private readonly logger = new Logger(TemporalClientService.name);
  private clientPromise: Promise<Client> | null = null;
  private connection: Connection | null = null;
  private shutdownComplete = false;

  constructor(private readonly appConfig: AppConfigService) {}

  /**
   * Lazy `Client` resolver. Concurrent first-callers share the in-flight
   * promise (race-safe singleton, mirrors Python `asyncio.Lock` lazy-cache).
   * On connect failure the promise is rejected AND cleared so a retry can
   * try again from scratch.
   */
  async getRawClient(): Promise<Client> {
    if (this.clientPromise === null) {
      this.clientPromise = this.connectClient().catch((err) => {
        this.clientPromise = null;
        throw err;
      });
    }
    return this.clientPromise;
  }

  private async connectClient(): Promise<Client> {
    const address = this.appConfig.temporalAddress;
    const namespace = this.appConfig.temporalNamespace;
    // Boundary try/catch: connection failure must surface as a typed
    // ErrorCode so callers (Story 13.3 IngestTranscriptUseCase) can soft-fail.
    try {
      const connection = await Connection.connect({ address });
      this.connection = connection;
      const client = new Client({ connection, namespace });
      this.logger.log({
        message: 'temporal client connected',
        event: 'temporalClient.connect.completed',
        address,
        namespace,
      });
      return client;
    } catch (err) {
      this.logger.error({
        message: 'temporal client connection failed',
        event: 'temporalClient.connect.failed',
        address,
        errorClass: (err as { name?: string })?.name ?? 'Error',
      });
      throw new InternalException(ErrorCode.TEMPORAL_CONNECTION_FAILED, `Temporal connection failed: ${(err as Error).message}`);
    }
  }

  async signalCoordinator(kind: CoordinatorSignalKind, payload: Record<string, unknown>): Promise<void> {
    const signalName = `submit_${kind}`;
    // Connect failure (TEMPORAL_CONNECTION_FAILED) bubbles unchanged from
    // getRawClient — no wrapper try/catch needed; the caller (Story 13.3
    // IngestTranscriptUseCase) catches both connect and signal errors at
    // its own boundary.
    const client = await this.getRawClient();

    // Boundary try/catch: signal RPC errors map to TEMPORAL_SIGNAL_FAILED.
    try {
      const handle = client.workflow.getHandle(COORDINATOR_WORKFLOW_ID);
      await handle.signal(signalName, payload);
    } catch (err) {
      this.logger.error({
        message: 'temporal signal failed',
        event: 'temporalClient.signalCoordinator.failed',
        kind,
        errorClass: (err as { name?: string })?.name ?? 'Error',
      });
      throw new InternalException(ErrorCode.TEMPORAL_SIGNAL_FAILED, `Signal failed: ${(err as Error).message}`);
    }

    this.logger.log({
      message: 'temporal coordinator signal sent',
      event: 'temporalClient.signalCoordinator.completed',
      kind,
      workflowId: COORDINATOR_WORKFLOW_ID,
      signalName,
      ...this.sanitiseLogMeta(payload),
    });
  }

  async ensureCoordinatorRunning(): Promise<void> {
    const client = await this.getRawClient();
    const taskQueue = this.appConfig.temporalTaskQueue;

    // Boundary try/catch: WorkflowExecutionAlreadyStartedError is the
    // idempotent path (coordinator already running) — swallow + log skipped.
    // Any other error maps to TEMPORAL_WORKFLOW_START_FAILED.
    try {
      await client.workflow.start(COORDINATOR_WORKFLOW_TYPE, {
        workflowId: COORDINATOR_WORKFLOW_ID,
        taskQueue,
        workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
        args: [],
      });
    } catch (err) {
      if (err instanceof WorkflowExecutionAlreadyStartedError) {
        this.logger.log({
          message: 'temporal coordinator workflow already running',
          event: 'temporalClient.coordinatorStart.skipped',
          workflowId: COORDINATOR_WORKFLOW_ID,
          reason: 'alreadyRunning',
        });
        return;
      }
      throw new InternalException(ErrorCode.TEMPORAL_WORKFLOW_START_FAILED, `Coordinator workflow start failed: ${(err as Error).message}`);
    }

    this.logger.log({
      message: 'temporal coordinator workflow started',
      event: 'temporalClient.coordinatorStart.completed',
      workflowId: COORDINATOR_WORKFLOW_ID,
    });
  }

  async registerSchedules(): Promise<void> {
    // Empty placeholder — Story 13.13 fills with `client.schedule.create(...)`
    // / `handle.update(...)` calls per Python `temporal_schedules.py:46-83`.
    this.logger.log({
      message: 'temporal schedule registration deferred',
      event: 'temporalClient.registerSchedules.skipped',
      reason: 'story13.13Pending',
    });
  }

  async healthy(): Promise<{ healthy: boolean; message: string }> {
    if (this.clientPromise === null) {
      return { healthy: false, message: 'not-connected' };
    }
    let client: Client;
    try {
      client = await this.clientPromise;
    } catch {
      return { healthy: false, message: 'not-connected' };
    }

    // Boundary try/catch: design D requires graceful degradation — never
    // throw. Timeout via Promise.race so a stuck Temporal RPC doesn't
    // block /health past 2 s.
    try {
      await Promise.race([
        client.connection.workflowService.getSystemInfo({}),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('timeout')), HEALTHY_TIMEOUT_MS);
        }),
      ]);
      return { healthy: true, message: 'connected' };
    } catch (err) {
      const detail = (err as Error).message ?? 'unknown';
      return { healthy: false, message: `unreachable: ${detail.slice(0, 80)}` };
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.shutdownComplete) return;

    if (this.connection === null && this.clientPromise === null) {
      this.logger.log({
        message: 'temporal client shutdown skipped — never connected',
        event: 'temporalClient.shutdown.skipped',
        reason: 'neverConnected',
      });
      this.shutdownComplete = true;
      return;
    }

    if (this.connection !== null) {
      // Boundary try/catch: a connection-already-dead transport error must
      // NOT block process exit. Log warn and clear references either way
      // so subsequent shutdown calls are no-ops.
      try {
        await this.connection.close();
      } catch (err) {
        this.logger.warn({
          message: 'temporal client connection close failed — clearing references anyway',
          event: 'temporalClient.shutdown.failed',
          errorClass: (err as { name?: string })?.name ?? 'Error',
        });
      }
      this.connection = null;
    }
    this.clientPromise = null;
    this.shutdownComplete = true;
    this.logger.log({
      message: 'temporal client shutdown completed',
      event: 'temporalClient.shutdown.completed',
    });
  }

  /**
   * Strip content-bearing field names from log meta (Story 13.3 sanitisation
   * preserved). Only field NAMES that smell like content are dropped; ID
   * fields like `transcript_id` stay because they're not content.
   */
  private sanitiseLogMeta(payload: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) {
      if (FORBIDDEN_FIELD_REGEX.test(k)) continue;
      out[k] = v;
    }
    return out;
  }
}
