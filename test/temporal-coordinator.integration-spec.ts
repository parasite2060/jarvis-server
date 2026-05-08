/**
 * Integration spec for Story 13.9 — `dreamCoordinatorWorkflow` against the
 * `@temporalio/testing` Test Server (Q9 = createLocal for integration).
 *
 * Mirrors Python Story 12.9's `test_coordinator_serialisation` for scenario
 * (b) — single-active-dream invariant proven empirically by timestamp
 * ordering of two consecutive light dreams.
 *
 * Five GWT scenarios per AC #14:
 *   (a) Coordinator boots and accepts signals — `submit_light` lands
 *       payload verbatim into the LightDream child stub.
 *   (b) Two-signal serialisation invariant — second light child's startMs
 *       is >= first light child's endMs (Python Story 12.9 parity).
 *   (c) Mixed-kind FIFO ordering — light → deep → weekly all execute in
 *       submission order with the right workflow IDs.
 *   (d) Idempotent ensureCoordinatorRunning — second call swallows
 *       WorkflowExecutionAlreadyStartedError; existing instance still
 *       handles signals.
 *   (e) Failed child does not block — a LightDream that throws does not
 *       prevent the next signal's child from running.
 *
 * Each test scopes its own task queue + recorder workflow ID so test
 * fixtures don't collide. The `coord-singleton` workflow ID is shared
 * across tests because it lives in `TemporalClientService` as a
 * package-level constant; we terminate it at the end of every test to
 * keep tests independent.
 */
import * as path from 'node:path';
import { INestApplication, Injectable } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { NativeConnection, Worker } from '@temporalio/worker';
import { AppConfigService } from '../src/shared/config/config.service';
import { ActivityRegistry } from '../src/shared/temporal/activity-registry.service';
import { TemporalActivity } from '../src/shared/temporal/decorators/temporal-activity.decorator';
import { TemporalClientService } from '../src/shared/temporal/temporal-client.service';
import { TemporalWorkerService } from '../src/shared/temporal/temporal-worker.service';
import type { ChildExecutionRecord } from './fixtures/temporal/coordinator-workflows';

const TASK_QUEUE_BASE = 'jarvis-dream-coordinator-test';
const COORDINATOR_WORKFLOW_ID = 'coord-singleton';

@Injectable()
class NoopActivities {
  // Coordinator child workflows are stubs and don't call activities, but
  // the worker AND-condition requires at least one activity to boot.
  @TemporalActivity('test.coordinator.noop')
  async noop(): Promise<string> {
    return 'ok';
  }
}

interface TestHarness {
  app: INestApplication;
  worker: Worker;
  runPromise: Promise<void>;
  connection: NativeConnection;
  taskQueue: string;
  recorderId: string;
}

async function buildHarness(testEnv: TestWorkflowEnvironment, scenarioId: string): Promise<TestHarness> {
  const taskQueue = `${TASK_QUEUE_BASE}-${scenarioId}`;
  // Recorder workflow ID is FIXED ('test-recorder-singleton') because the
  // child stub workflows in `test/fixtures/temporal/coordinator-workflows`
  // import it as a module-level constant. We isolate tests by terminating
  // the recorder + coord-singleton in `teardown()` so the next test starts
  // fresh.
  const recorderId = 'test-recorder-singleton';

  const moduleRef = await Test.createTestingModule({
    imports: [DiscoveryModule],
    providers: [
      NoopActivities,
      ActivityRegistry,
      TemporalClientService,
      TemporalWorkerService,
      {
        provide: AppConfigService,
        useValue: {
          temporalAddress: testEnv.address,
          temporalNamespace: testEnv.namespace ?? 'default',
          temporalTaskQueue: taskQueue,
        } as unknown as AppConfigService,
      },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();

  const connection = await NativeConnection.connect({ address: testEnv.address });
  const workflowsPath = path.resolve(__dirname, 'fixtures/temporal/coordinator-workflows');
  const activities = app.get(TemporalWorkerService).collectActivities(app);
  const worker = await Worker.create({
    connection,
    namespace: testEnv.namespace ?? 'default',
    taskQueue,
    workflowsPath,
    activities,
  });
  const runPromise = worker.run().catch(() => undefined);

  return { app, worker, runPromise, connection, taskQueue, recorderId };
}

async function startRecorder(testEnv: TestWorkflowEnvironment, harness: TestHarness): Promise<void> {
  await testEnv.client.workflow.start('recorderWorkflow', {
    workflowId: harness.recorderId,
    taskQueue: harness.taskQueue,
    args: [],
  });
}

async function readRecords(testEnv: TestWorkflowEnvironment, harness: TestHarness): Promise<ChildExecutionRecord[]> {
  const handle = testEnv.client.workflow.getHandle(harness.recorderId);
  return (await handle.query('getRecords')) as ChildExecutionRecord[];
}

async function waitFor<T>(predicate: () => Promise<T | null>, timeoutMs = 15_000, pollMs = 100): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await predicate();
    if (result !== null) return result;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error('waitFor: timed out');
}

async function teardown(testEnv: TestWorkflowEnvironment, harness: TestHarness): Promise<void> {
  // Terminate workflows so subsequent tests don't trip
  // WorkflowExecutionAlreadyStartedError on `coord-singleton` reuse. The
  // recorder is per-scenario but we terminate too for tidiness.
  await testEnv.client.workflow
    .getHandle(COORDINATOR_WORKFLOW_ID)
    .terminate('test-cleanup')
    .catch(() => undefined);
  await testEnv.client.workflow
    .getHandle(harness.recorderId)
    .terminate('test-cleanup')
    .catch(() => undefined);

  harness.worker.shutdown();
  await harness.runPromise;
  await harness.connection.close();
  await harness.app.close();
}

describe('dreamCoordinatorWorkflow (integration — Test Server)', () => {
  jest.setTimeout(120_000);

  let testEnv: TestWorkflowEnvironment;

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createLocal();
  });

  afterAll(async () => {
    if (testEnv) await testEnv.teardown();
  });

  it('(a) coordinator boots and accepts a submit_light signal — payload preserved verbatim', async () => {
    // GIVEN a Nest app + a worker booted against the coordinator-workflows fixture bundle
    const harness = await buildHarness(testEnv, 'a');
    try {
      await startRecorder(testEnv, harness);
      await harness.app.get(TemporalClientService).ensureCoordinatorRunning();

      // WHEN signalCoordinator('light', ...) is called with snake_case payload
      const payload = { session_id: 's1', transcript_id: 't1' };
      await harness.app.get(TemporalClientService).signalCoordinator('light', payload);

      // THEN the LightDream child runs with payload preserved verbatim
      const records = await waitFor<ChildExecutionRecord[]>(async () => {
        const r = await readRecords(testEnv, harness);
        return r.length >= 1 ? r : null;
      });
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        kind: 'light',
        workflowId: 'light-s1',
        payload: { session_id: 's1', transcript_id: 't1' },
        threw: false,
      });
    } finally {
      await teardown(testEnv, harness);
    }
  });

  it('(b) two consecutive submit_light signals serialise — second child startMs >= first child endMs (Python Story 12.9 parity)', async () => {
    // GIVEN coordinator + worker up
    const harness = await buildHarness(testEnv, 'b');
    try {
      await startRecorder(testEnv, harness);
      await harness.app.get(TemporalClientService).ensureCoordinatorRunning();

      // WHEN two submit_light signals are sent in quick succession
      const client = harness.app.get(TemporalClientService);
      await client.signalCoordinator('light', { session_id: 'b1' });
      await client.signalCoordinator('light', { session_id: 'b2' });

      // THEN both children execute AND second.startMs >= first.endMs (single-active-dream)
      const records = await waitFor<ChildExecutionRecord[]>(async () => {
        const r = await readRecords(testEnv, harness);
        return r.length >= 2 ? r : null;
      });
      expect(records).toHaveLength(2);
      const [first, second] = records as [ChildExecutionRecord, ChildExecutionRecord];
      expect(first.workflowId).toBe('light-b1');
      expect(second.workflowId).toBe('light-b2');
      expect(second.startMs).toBeGreaterThanOrEqual(first.endMs);
    } finally {
      await teardown(testEnv, harness);
    }
  });

  it('(c) mixed-kind FIFO — submit_light → submit_deep → submit_weekly all execute in submission order', async () => {
    // GIVEN coordinator + worker up
    const harness = await buildHarness(testEnv, 'c');
    try {
      await startRecorder(testEnv, harness);
      await harness.app.get(TemporalClientService).ensureCoordinatorRunning();

      // WHEN three signals of different kinds land in order
      const client = harness.app.get(TemporalClientService);
      await client.signalCoordinator('light', { session_id: 'c1' });
      await client.signalCoordinator('deep', { target_date: '2026-05-08' });
      await client.signalCoordinator('weekly', { week_start: '2026-W18' });

      // THEN three children execute, IDs match, FIFO ordering preserved
      const records = await waitFor<ChildExecutionRecord[]>(async () => {
        const r = await readRecords(testEnv, harness);
        return r.length >= 3 ? r : null;
      });
      expect(records).toHaveLength(3);
      expect(records.map((r) => r.workflowId)).toEqual(['light-c1', 'deep-2026-05-08', 'weekly-2026-W18']);
      // FIFO ordering: each subsequent child's startMs >= prior's endMs
      expect(records[1]!.startMs).toBeGreaterThanOrEqual(records[0]!.endMs);
      expect(records[2]!.startMs).toBeGreaterThanOrEqual(records[1]!.endMs);
    } finally {
      await teardown(testEnv, harness);
    }
  });

  it('(d) ensureCoordinatorRunning is idempotent — second call swallows the already-started error', async () => {
    // GIVEN coordinator + worker up + first ensureCoordinatorRunning succeeded
    const harness = await buildHarness(testEnv, 'd');
    try {
      await startRecorder(testEnv, harness);
      const client = harness.app.get(TemporalClientService);
      await client.ensureCoordinatorRunning();

      // WHEN ensureCoordinatorRunning is called a second time
      // THEN it does NOT throw
      await expect(client.ensureCoordinatorRunning()).resolves.toBeUndefined();

      // AND the existing coordinator instance still handles signals
      await client.signalCoordinator('light', { session_id: 'd1' });
      const records = await waitFor<ChildExecutionRecord[]>(async () => {
        const r = await readRecords(testEnv, harness);
        return r.length >= 1 ? r : null;
      });
      expect(records[0]!.workflowId).toBe('light-d1');
    } finally {
      await teardown(testEnv, harness);
    }
  });

  it('(e) failed child does not block subsequent signals — coordinator continues despite per-iteration error', async () => {
    // GIVEN coordinator + worker up
    const harness = await buildHarness(testEnv, 'e');
    try {
      await startRecorder(testEnv, harness);
      const client = harness.app.get(TemporalClientService);
      await client.ensureCoordinatorRunning();

      // WHEN a signal targets a LightDream child that will throw, followed by a healthy signal
      await client.signalCoordinator('light', { session_id: 'e1', _shouldThrow: true });
      await client.signalCoordinator('deep', { target_date: '2026-05-09' });

      // THEN both children executed (the failed one with threw:true) AND the deep dream still ran
      const records = await waitFor<ChildExecutionRecord[]>(async () => {
        const r = await readRecords(testEnv, harness);
        return r.length >= 2 ? r : null;
      });
      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({ kind: 'light', workflowId: 'light-e1', threw: true });
      expect(records[1]).toMatchObject({ kind: 'deep', workflowId: 'deep-2026-05-09', threw: false });
    } finally {
      await teardown(testEnv, harness);
    }
  });
});
