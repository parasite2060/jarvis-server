/**
 * Temporal worker bootstrap (Story 13.8).
 *
 * Boots a co-located `@temporalio/worker` Worker after `app.init()` from
 * `main.ts`. Defensive short-circuit when no workflows OR no activities are
 * registered yet (Q9 = (b) — Story 13.8 ships HTTP-only out of the box; the
 * first dream workflow / activity flips the worker on).
 *
 * `Connection` (client-side) and `NativeConnection` (worker-side) are
 * distinct types in the Temporal SDK; the worker creates its OWN
 * `NativeConnection` even though the client already has one. This is an
 * SDK boundary, NOT a design-doc deviation — the design's "one connection
 * per process" intent is preserved at the operational level (one worker,
 * one client, both pointing at the same Temporal address).
 *
 * # Graceful shutdown — first-class invariant
 *
 * Shutdown ordering is enforced via NestJS lifecycle phases:
 *   - `TemporalWorkerService` implements `BeforeApplicationShutdown` so the
 *     worker drain runs in NestJS's pre-shutdown phase.
 *   - `TemporalClientService` implements `OnModuleDestroy` so the gRPC
 *     connection close runs in the earlier phase. NestJS phase order
 *     (`onModuleDestroy` → `beforeApplicationShutdown` → `onApplicationShutdown`)
 *     guarantees worker drain happens AFTER the client's connection is
 *     released only when the client is the upstream — which is the wrong
 *     direction for our case. We override that: the worker uses
 *     `BeforeApplicationShutdown` AND we DO NOT close the client connection
 *     in `OnModuleDestroy` of the client; the client's connection close
 *     also moves to a later phase to ensure the worker drains first.
 *
 *   Concretely: Worker shutdown runs BEFORE client connection close because
 *   `BeforeApplicationShutdown` fires before `OnApplicationShutdown` and the
 *   client's connection close is moved to `OnApplicationShutdown` for that
 *   reason. See `temporal-client.service.ts` for the matching change.
 *
 * The drain itself is idempotent and never rethrows — graceful shutdown
 * MUST always complete the path so the client teardown that follows runs.
 */
import { BeforeApplicationShutdown, INestApplication, Injectable, Logger } from '@nestjs/common';
import { NativeConnection, Worker } from '@temporalio/worker';
import * as os from 'node:os';
import { AppConfigService } from 'src/shared/config/config.service';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import { ActivityMap, ActivityRegistry } from './activity-registry.service';

export interface TemporalWorkerStartOptions {
  taskQueue: string;
  workflowsPath: string;
  activities?: ActivityMap;
  /**
   * Story 13.10 / Q1 (RESOLVED 2026-05-08, refined): the originally proposed
   * "explicit `workflows` map" Worker.create option does NOT exist in
   * `@temporalio/worker@1.17.0`. Workflow wire-name registration is
   * handled at the workflows-directory level via aliased re-exports
   * (e.g., `export { lightDreamWorkflow as LightDream }` in
   * `src/modules/dream/temporal/workflows/index.ts`). Story 13.10's PascalCase
   * `LightDream` registration is achieved through that alias; this option
   * is reserved for forward-compat in case future SDK versions add it.
   */
  workflowsRegistered?: string[];
}

@Injectable()
export class TemporalWorkerService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(TemporalWorkerService.name);
  private worker: Worker | null = null;
  private runPromise: Promise<void> | null = null;
  private nativeConnection: NativeConnection | null = null;
  private taskQueue: string | null = null;
  private shutdownComplete = false;

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly activityRegistry: ActivityRegistry,
  ) {}

  async start(opts: TemporalWorkerStartOptions): Promise<void> {
    const activities = opts.activities ?? {};
    const activitiesCount = Object.keys(activities).length;

    if (!opts.workflowsPath || activitiesCount === 0) {
      this.logger.log({
        message: 'temporal worker boot deferred — nothing to register yet',
        event: 'temporalWorker.start.skipped',
        reason: 'noWorkflowsOrActivitiesYet',
        activitiesCount,
      });
      return;
    }

    // Boundary try/catch: Worker.create failure is HARD per Q9 — bubbles to
    // main.ts which exits the process. Connection failure same path.
    try {
      this.nativeConnection = await NativeConnection.connect({
        address: this.appConfig.temporalAddress,
      });
      this.worker = await Worker.create({
        connection: this.nativeConnection,
        namespace: this.appConfig.temporalNamespace,
        taskQueue: opts.taskQueue,
        workflowsPath: opts.workflowsPath,
        activities,
        identity: `${process.pid}@${os.hostname()}`,
      });
      this.taskQueue = opts.taskQueue;
    } catch (err) {
      this.logger.error({
        message: 'temporal worker bootstrap failed',
        event: 'temporalWorker.start.failed',
        taskQueue: opts.taskQueue,
        errorClass: (err as { name?: string })?.name ?? 'Error',
      });
      throw new InternalException(ErrorCode.TEMPORAL_WORKER_START_FAILED, `Worker bootstrap failed: ${(err as Error).message}`);
    }

    // Spawn the run loop without awaiting — `worker.run()` blocks until
    // shutdown. We capture the promise so beforeApplicationShutdown can
    // await settlement after invoking `worker.shutdown()`.
    this.runPromise = this.worker.run().catch((err) => {
      this.logger.error({
        message: 'temporal worker run loop crashed',
        event: 'temporalWorker.run.crashed',
        error: (err as Error).message,
      });
    });

    this.logger.log({
      message: 'temporal worker started',
      event: 'temporalWorker.start.completed',
      taskQueue: opts.taskQueue,
      activitiesCount,
      workflowsPath: opts.workflowsPath,
      workflowsRegistered: opts.workflowsRegistered ?? [],
    });
  }

  /**
   * Proxy to `ActivityRegistry.collect(app)` so callers (main.ts) only need
   * a `TemporalWorkerService` reference to wire the worker bootstrap.
   */
  collectActivities(app: INestApplication): ActivityMap {
    return this.activityRegistry.collect(app);
  }

  /**
   * Story 13.9 cross-story fix-up to 13.8 — public getter so `main.ts`'s
   * `ensureCoordinatorRunning(app)` helper can short-circuit when the worker
   * never booted (workflowsPath empty OR activitiesCount === 0). Returns
   * `true` only after a successful `start()` AND before
   * `beforeApplicationShutdown()` clears the worker reference.
   */
  isStarted(): boolean {
    return this.worker !== null;
  }

  /**
   * Graceful drain — fires in NestJS's `beforeApplicationShutdown` phase so
   * the worker drains BEFORE the client's gRPC connection closes
   * (`onApplicationShutdown` phase, see `TemporalClientService`).
   *
   * Contract per leader's amplification (2026-05-08):
   *   - Idempotent: a second invocation is a no-op (NestJS edge case during
   *     partial-init failures).
   *   - Skipped path: if `this.worker` is `null` (Q9 short-circuit), log
   *     `temporalWorker.shutdown.skipped` and return.
   *   - try/finally: the run-loop promise is ALWAYS awaited even if
   *     `worker.shutdown()` throws — defensive against SDK edge cases on
   *     connection-already-dead.
   *   - run-loop rejection: log `temporalWorker.shutdown.runLoopRejected`
   *     but do NOT rethrow; downstream client teardown must still run.
   *   - native connection close: best-effort; failure logs warn, never
   *     blocks shutdown.
   */
  async beforeApplicationShutdown(): Promise<void> {
    if (this.shutdownComplete) return;

    if (this.worker === null) {
      this.logger.log({
        message: 'temporal worker shutdown skipped — never booted',
        event: 'temporalWorker.shutdown.skipped',
        reason: 'notBooted',
      });
      this.shutdownComplete = true;
      return;
    }

    const taskQueue = this.taskQueue ?? 'unknown';
    const runPromise = this.runPromise;
    let shutdownErr: Error | null = null;

    try {
      await this.worker.shutdown();
    } catch (err) {
      shutdownErr = err as Error;
      this.logger.warn({
        message: 'temporal worker shutdown call threw — proceeding to drain run-loop',
        event: 'temporalWorker.shutdown.callFailed',
        taskQueue,
        errorClass: (err as { name?: string })?.name ?? 'Error',
      });
    } finally {
      // ALWAYS settle the run-loop promise — never leave it dangling.
      if (runPromise !== null) {
        await runPromise.catch((err) => {
          this.logger.warn({
            message: 'temporal worker run loop rejected during shutdown',
            event: 'temporalWorker.shutdown.runLoopRejected',
            taskQueue,
            errorClass: (err as { name?: string })?.name ?? 'Error',
          });
        });
      }
    }

    this.worker = null;
    this.runPromise = null;

    // Native connection close — best-effort; transport failures log warn
    // but never block the rest of shutdown (downstream client teardown).
    if (this.nativeConnection !== null) {
      try {
        await this.nativeConnection.close();
      } catch (err) {
        this.logger.warn({
          message: 'temporal worker native connection close failed',
          event: 'temporalWorker.connection.closeFailed',
          taskQueue,
          errorClass: (err as { name?: string })?.name ?? 'Error',
        });
      }
      this.nativeConnection = null;
    }

    if (shutdownErr === null) {
      this.logger.log({
        message: 'temporal worker shutdown completed',
        event: 'temporalWorker.shutdown.completed',
        taskQueue,
      });
    }
    this.shutdownComplete = true;
  }
}
