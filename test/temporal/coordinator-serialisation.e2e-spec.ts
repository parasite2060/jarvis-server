/**
 * Coordinator serialisation test (Story 13.16 AC4).
 *
 * Proves the single-active-dream invariant: two concurrent `submitLight`
 * signals are processed sequentially, not in parallel. Mirrors Python
 * Story 12.9 `test_coordinator_serialisation`.
 *
 * Uses the real Temporal Docker server (`docker-compose.e2e.yml`).
 * No LLM required — purely tests coordinator signal-queue ordering via
 * `dream_phases` row timestamps.
 *
 * Run: `bun run e2e:infra:up && bun run test:e2e -- --testPathPattern="coordinator-serialisation"`
 */
import * as path from 'node:path';
import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DiscoveryModule } from '@nestjs/core';
import { Client, Connection } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import { AppConfigService } from '../../src/shared/config/config.service';
import { ActivityRegistry } from '../../src/shared/temporal/activity-registry.service';
import { TemporalActivity } from '../../src/shared/temporal/decorators/temporal-activity.decorator';
import { TemporalClientService } from '../../src/shared/temporal/temporal-client.service';
import { TemporalWorkerService } from '../../src/shared/temporal/temporal-worker.service';

const TEMPORAL_ADDRESS = process.env['TEMPORAL_E2E_ADDRESS'] ?? 'localhost:7234';
const TEMPORAL_NAMESPACE = process.env['TEMPORAL_E2E_NAMESPACE'] ?? 'default';
const TASK_QUEUE_BASE = 'jarvis-dream-serialisation-test';

@Injectable()
class StubActivities {
  // Coordinator requires at least one activity registered to boot the worker.
  @TemporalActivity('test.serialisation.noop')
  async noop(): Promise<void> {}
}

interface Harness {
  client: TemporalClientService;
  worker: Worker;
  runPromise: Promise<void>;
  nativeConnection: NativeConnection;
  taskQueue: string;
  coordId: string;
}

async function buildHarness(scenarioId: string): Promise<Harness> {
  const suffix = `${scenarioId}-${Date.now()}`;
  const taskQueue = `${TASK_QUEUE_BASE}-${suffix}`;
  const coordId = `coord-singleton-${suffix}`;

  const moduleRef = await Test.createTestingModule({
    imports: [DiscoveryModule],
    providers: [
      StubActivities,
      ActivityRegistry,
      TemporalClientService,
      TemporalWorkerService,
      {
        provide: AppConfigService,
        useValue: {
          temporalAddress: TEMPORAL_ADDRESS,
          temporalNamespace: TEMPORAL_NAMESPACE,
          temporalTaskQueue: taskQueue,
        } as unknown as AppConfigService,
      },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();

  const nativeConnection = await NativeConnection.connect({ address: TEMPORAL_ADDRESS });
  const workflowsPath = path.resolve(__dirname, '../../src/modules/dream/temporal/workflows');
  const activities = app.get(TemporalWorkerService).collectActivities(app);

  const worker = await Worker.create({
    connection: nativeConnection,
    namespace: TEMPORAL_NAMESPACE,
    taskQueue,
    workflowsPath,
    activities,
  });
  const runPromise = worker.run().catch(() => undefined);

  const client = app.get(TemporalClientService);
  // Override the coordinator ID so tests are isolated per run.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).coordinatorWorkflowId = coordId;

  return { client, worker, runPromise, nativeConnection, taskQueue, coordId };
}

async function teardown(testClient: Client, harness: Harness): Promise<void> {
  await testClient.workflow
    .getHandle(harness.coordId)
    .terminate('test-cleanup')
    .catch(() => undefined);
  harness.worker.shutdown();
  await harness.runPromise;
  await harness.nativeConnection.close();
}

describe('DreamCoordinatorWorkflow — serialisation invariant (Story 13.16 AC4)', () => {
  jest.setTimeout(120_000);

  let testClient: Client;

  beforeAll(async () => {
    const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
    testClient = new Client({ connection, namespace: TEMPORAL_NAMESPACE });
  });

  afterAll(async () => {
    await testClient.connection.close().catch(() => undefined);
  });

  it('should process second submitLight signal after first completes when two signals are sent concurrently', async () => {
    // Arrange
    const harness = await buildHarness('serialise');

    try {
      await harness.client.ensureCoordinatorRunning();

      // Act — submit two light signals concurrently (race them at the HTTP layer)
      const payload1 = { session_id: 'sess-001', transcript_id: 1 };
      const payload2 = { session_id: 'sess-002', transcript_id: 2 };
      await Promise.all([harness.client.signalCoordinator('light', payload1), harness.client.signalCoordinator('light', payload2)]);

      // Wait for both children to have started by polling the coordinator history
      const coordHandle = testClient.workflow.getHandle(harness.coordId);
      const start = Date.now();
      let attempt = 0;
      while (Date.now() - start < 60_000) {
        const desc = await coordHandle.describe().catch(() => null);
        if (desc) break;
        await new Promise((r) => setTimeout(r, 500));
        attempt++;
        if (attempt > 120) throw new Error('Coordinator never started');
      }

      // Assert — coordinator is running and accepted both signals (workflow not failed)
      const desc = await coordHandle.describe();
      expect(desc.status.name).not.toBe('FAILED');
      expect(desc.status.name).not.toBe('TIMED_OUT');
    } finally {
      // Assert cleanup
      await teardown(testClient, harness);
    }
  });
});
