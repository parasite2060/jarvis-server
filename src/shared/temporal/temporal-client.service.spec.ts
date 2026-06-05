/**
 * Unit specs for `TemporalClientService` (Story 13.8 retrofit of Story 13.3
 * stub spec). Covers per AC #14 + leader's graceful-shutdown amplification:
 *   - signalCoordinator happy path + connect-failure + signal-rpc-failure
 *   - ensureCoordinatorRunning happy path + already-started swallow
 *   - registerSchedules no-op
 *   - healthy() not-connected / connected / unreachable / never-throws
 *   - onApplicationShutdown: connection close + idempotency + skipped
 *     (neverConnected) path + close-failure warn-without-rethrow
 *
 * `@temporalio/client` is mocked module-wide via `jest.mock(...)`.
 */
import { Logger } from '@nestjs/common';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import {
  Client,
  Connection,
  ScheduleNotFoundError,
  ScheduleOverlapPolicy,
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdReusePolicy,
} from '@temporalio/client';
import { AppConfigService } from 'src/shared/config/config.service';
import { ErrorCode } from 'src/utils/error.code';
import { InternalException } from 'src/shared/common/models/exception';
import { TemporalClientService } from './temporal-client.service';

jest.mock('@temporalio/client', () => {
  // Re-export real symbols (enums + error class) but stub Connection/Client
  // factories so we can drive their behaviour from tests.
  const actual = jest.requireActual('@temporalio/client');
  return {
    ...actual,
    Connection: { connect: jest.fn() },
    Client: jest.fn(),
  };
});

const TEMPORAL_ADDRESS = 'temporal-test:7233';
const TEMPORAL_NAMESPACE = 'jarvis-test';
const TEMPORAL_TASK_QUEUE = 'jarvis-dream-test';

interface MockHandle {
  signal: jest.Mock;
}

interface MockScheduleHandle {
  describe: jest.Mock;
  update: jest.Mock;
}

interface MockClient {
  workflow: {
    getHandle: jest.Mock<MockHandle, [string]>;
    start: jest.Mock;
  };
  schedule: {
    getHandle: jest.Mock<MockScheduleHandle, [string]>;
    create: jest.Mock;
  };
  connection: {
    workflowService: { getSystemInfo: jest.Mock };
    close: jest.Mock;
  };
}

function buildMockClient(): MockClient {
  return {
    workflow: {
      getHandle: jest.fn().mockReturnValue({ signal: jest.fn().mockResolvedValue(undefined) }),
      start: jest.fn().mockResolvedValue(undefined),
    },
    schedule: {
      getHandle: jest.fn().mockReturnValue({
        describe: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue(undefined),
      }),
      create: jest.fn().mockResolvedValue(undefined),
    },
    connection: {
      workflowService: { getSystemInfo: jest.fn().mockResolvedValue({}) },
      close: jest.fn().mockResolvedValue(undefined),
    },
  };
}

describe('TemporalClientService', () => {
  let target: TemporalClientService;
  let mockAppConfig: DeepMocked<AppConfigService>;
  let mockClient: MockClient;
  const ConnectionConnectMock = Connection.connect as unknown as jest.Mock;
  const ClientCtorMock = Client as unknown as jest.Mock;

  beforeEach(() => {
    // Arrange: silence Nest logger
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    mockAppConfig = createMock<AppConfigService>();
    Object.defineProperty(mockAppConfig, 'temporalAddress', { value: TEMPORAL_ADDRESS, configurable: true });
    Object.defineProperty(mockAppConfig, 'temporalNamespace', { value: TEMPORAL_NAMESPACE, configurable: true });
    Object.defineProperty(mockAppConfig, 'temporalTaskQueue', { value: TEMPORAL_TASK_QUEUE, configurable: true });

    mockClient = buildMockClient();
    ConnectionConnectMock.mockResolvedValue(mockClient.connection);
    ClientCtorMock.mockImplementation(() => mockClient);

    target = new TemporalClientService(mockAppConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('signalCoordinator', () => {
    it('lazy-connects, signals submit_${kind}, and logs the completed event with sanitised meta', async () => {
      // Act
      await target.signalCoordinator('light', { transcript_id: 42, session_id: 'sess-1' });

      // Assert
      expect(ConnectionConnectMock).toHaveBeenCalledWith({ address: TEMPORAL_ADDRESS });
      expect(ClientCtorMock).toHaveBeenCalledWith({ connection: mockClient.connection, namespace: TEMPORAL_NAMESPACE });
      expect(mockClient.workflow.getHandle).toHaveBeenCalledWith('coord-singleton');
      const handle = mockClient.workflow.getHandle.mock.results[0]!.value;
      expect(handle.signal).toHaveBeenCalledWith('submit_light', { transcript_id: 42, session_id: 'sess-1' });
    });

    it('reuses the cached client across concurrent calls (race-safe singleton)', async () => {
      // Act — fire two calls before the first connect resolves
      await Promise.all([target.signalCoordinator('light', { session_id: 'a' }), target.signalCoordinator('deep', { session_id: 'b' })]);

      // Assert — Connection.connect called exactly once
      expect(ConnectionConnectMock).toHaveBeenCalledTimes(1);
      expect(ClientCtorMock).toHaveBeenCalledTimes(1);
    });

    it('throws InternalException(TEMPORAL_CONNECTION_FAILED) on connect failure', async () => {
      // Arrange
      ConnectionConnectMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      // Act + Assert
      await expect(target.signalCoordinator('light', { session_id: 's' })).rejects.toMatchObject({
        code: ErrorCode.TEMPORAL_CONNECTION_FAILED,
      });
    });

    it('throws InternalException(TEMPORAL_SIGNAL_FAILED) when handle.signal rejects', async () => {
      // Arrange
      mockClient.workflow.getHandle.mockReturnValueOnce({
        signal: jest.fn().mockRejectedValueOnce(new Error('workflow not found')),
      });

      // Act + Assert
      await expect(target.signalCoordinator('light', { session_id: 's' })).rejects.toMatchObject({
        code: ErrorCode.TEMPORAL_SIGNAL_FAILED,
      });
    });

    it('clears the cached promise after a connect failure so a retry can connect again', async () => {
      // Arrange — first connect fails, second succeeds
      ConnectionConnectMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      // Act — first call fails
      await expect(target.signalCoordinator('light', { session_id: 's' })).rejects.toBeInstanceOf(InternalException);

      // Act — second call should re-connect
      await target.signalCoordinator('light', { session_id: 's2' });

      // Assert
      expect(ConnectionConnectMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('ensureCoordinatorRunning', () => {
    it('starts coord-singleton with ALLOW_DUPLICATE_FAILED_ONLY policy and logs completed', async () => {
      // Act
      await target.ensureCoordinatorRunning();

      // Assert
      expect(mockClient.workflow.start).toHaveBeenCalledWith('dreamCoordinatorWorkflow', {
        workflowId: 'coord-singleton',
        taskQueue: TEMPORAL_TASK_QUEUE,
        workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
        args: [],
      });
    });

    it('swallows WorkflowExecutionAlreadyStartedError and logs skipped (idempotent)', async () => {
      // Arrange
      mockClient.workflow.start.mockRejectedValueOnce(
        new WorkflowExecutionAlreadyStartedError('already started', 'coord-singleton', 'dreamCoordinatorWorkflow'),
      );

      // Act
      await target.ensureCoordinatorRunning();

      // Assert — no throw; one start attempt
      expect(mockClient.workflow.start).toHaveBeenCalledTimes(1);
    });

    it('throws InternalException(TEMPORAL_WORKFLOW_START_FAILED) on non-idempotent failure', async () => {
      // Arrange
      mockClient.workflow.start.mockRejectedValueOnce(new Error('namespace not found'));

      // Act + Assert
      await expect(target.ensureCoordinatorRunning()).rejects.toMatchObject({
        code: ErrorCode.TEMPORAL_WORKFLOW_START_FAILED,
      });
    });
  });

  describe('registerSchedules (Story 13.13)', () => {
    const opts = { deepDreamCron: '0 20 * * *', weeklyReviewCron: '0 20 * * 0' };

    it('updates both schedules when both already exist (idempotent path)', async () => {
      // Arrange — describe succeeds for both → update path
      const deepHandle = { describe: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue(undefined) };
      const weeklyHandle = { describe: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue(undefined) };
      mockClient.schedule.getHandle.mockReturnValueOnce(deepHandle).mockReturnValueOnce(weeklyHandle);

      // Act
      await target.registerSchedules(opts);

      // Assert — describe + update for each; no create
      expect(mockClient.schedule.getHandle).toHaveBeenNthCalledWith(1, 'deep-dream-nightly');
      expect(mockClient.schedule.getHandle).toHaveBeenNthCalledWith(2, 'weekly-review');
      expect(deepHandle.describe).toHaveBeenCalled();
      expect(deepHandle.update).toHaveBeenCalled();
      expect(weeklyHandle.describe).toHaveBeenCalled();
      expect(weeklyHandle.update).toHaveBeenCalled();
      expect(mockClient.schedule.create).not.toHaveBeenCalled();
    });

    it('creates both schedules on ScheduleNotFoundError (first-boot path)', async () => {
      // Arrange — describe throws NotFound for both → fall through to create
      const notFound = (id: string) => new ScheduleNotFoundError('not found', id);
      const deepHandle = { describe: jest.fn().mockRejectedValue(notFound('deep-dream-nightly')), update: jest.fn() };
      const weeklyHandle = { describe: jest.fn().mockRejectedValue(notFound('weekly-review')), update: jest.fn() };
      mockClient.schedule.getHandle.mockReturnValueOnce(deepHandle).mockReturnValueOnce(weeklyHandle);

      // Act
      await target.registerSchedules(opts);

      // Assert — create called twice with correct shape
      expect(mockClient.schedule.create).toHaveBeenCalledTimes(2);
      const firstCall = mockClient.schedule.create.mock.calls[0]![0];
      expect(firstCall.scheduleId).toBe('deep-dream-nightly');
      expect(firstCall.spec.cronExpressions).toEqual(['0 20 * * *']);
      expect(firstCall.action.type).toBe('startWorkflow');
      expect(firstCall.action.workflowType).toBe('ScheduleSignalRelay');
      expect(firstCall.action.workflowId).toBe('deep-dream-nightly-relay');
      expect(firstCall.action.taskQueue).toBe(TEMPORAL_TASK_QUEUE);
      expect(firstCall.action.args).toEqual(['deep']);
      expect(firstCall.policies.overlap).toBe(ScheduleOverlapPolicy.SKIP);

      const secondCall = mockClient.schedule.create.mock.calls[1]![0];
      expect(secondCall.scheduleId).toBe('weekly-review');
      expect(secondCall.action.workflowId).toBe('weekly-review-relay');
      expect(secondCall.action.args).toEqual(['weekly']);
    });

    it('mixed path: deep exists, weekly does not — describe-update for deep + create for weekly', async () => {
      // Arrange
      const notFound = (id: string) => new ScheduleNotFoundError('not found', id);
      const deepHandle = { describe: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue(undefined) };
      const weeklyHandle = { describe: jest.fn().mockRejectedValue(notFound('weekly-review')), update: jest.fn() };
      mockClient.schedule.getHandle.mockReturnValueOnce(deepHandle).mockReturnValueOnce(weeklyHandle);

      // Act
      await target.registerSchedules(opts);

      // Assert
      expect(deepHandle.update).toHaveBeenCalled();
      expect(mockClient.schedule.create).toHaveBeenCalledTimes(1);
      expect(mockClient.schedule.create.mock.calls[0]![0].scheduleId).toBe('weekly-review');
    });

    it('throws InternalException(TEMPORAL_SCHEDULE_REGISTRATION_FAILED) on non-NotFound error during describe', async () => {
      // Arrange — describe throws something other than NotFound
      const deepHandle = { describe: jest.fn().mockRejectedValue(new Error('rpc disconnected')), update: jest.fn() };
      mockClient.schedule.getHandle.mockReturnValueOnce(deepHandle);

      // Act + Assert
      await expect(target.registerSchedules(opts)).rejects.toMatchObject({
        code: ErrorCode.TEMPORAL_SCHEDULE_REGISTRATION_FAILED,
      });
    });
  });

  describe('updateSchedule (Story 13.13)', () => {
    it('updates an existing schedule via the upsert helper', async () => {
      // Arrange
      const handle = { describe: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue(undefined) };
      mockClient.schedule.getHandle.mockReturnValueOnce(handle);

      // Act
      await target.updateSchedule('deep-dream-nightly', '0 21 * * *');

      // Assert
      expect(mockClient.schedule.getHandle).toHaveBeenCalledWith('deep-dream-nightly');
      expect(handle.update).toHaveBeenCalled();
    });

    it('falls through to create on ScheduleNotFoundError', async () => {
      // Arrange
      const notFound = new ScheduleNotFoundError('not found', 'weekly-review');
      const handle = { describe: jest.fn().mockRejectedValue(notFound), update: jest.fn() };
      mockClient.schedule.getHandle.mockReturnValueOnce(handle);

      // Act
      await target.updateSchedule('weekly-review', '0 22 * * 0');

      // Assert
      expect(mockClient.schedule.create).toHaveBeenCalledTimes(1);
      const callArgs = mockClient.schedule.create.mock.calls[0]![0];
      expect(callArgs.scheduleId).toBe('weekly-review');
      expect(callArgs.spec.cronExpressions).toEqual(['0 22 * * 0']);
      expect(callArgs.action.args).toEqual(['weekly']);
    });

    it('throws InternalException(TEMPORAL_SCHEDULE_REGISTRATION_FAILED) on non-NotFound error', async () => {
      // Arrange
      const handle = { describe: jest.fn().mockRejectedValue(new Error('rpc disconnected')), update: jest.fn() };
      mockClient.schedule.getHandle.mockReturnValueOnce(handle);

      // Act + Assert
      await expect(target.updateSchedule('deep-dream-nightly', '0 21 * * *')).rejects.toMatchObject({
        code: ErrorCode.TEMPORAL_SCHEDULE_REGISTRATION_FAILED,
      });
    });
  });

  describe('healthy', () => {
    it('returns not-connected without triggering a connection when never called yet', async () => {
      // Act
      const result = await target.healthy();

      // Assert
      expect(result).toEqual({ healthy: false, message: 'not-connected' });
      expect(ConnectionConnectMock).not.toHaveBeenCalled();
    });

    it('returns connected when getSystemInfo resolves within timeout', async () => {
      // Arrange — establish the connection by issuing a signal first
      await target.signalCoordinator('light', { session_id: 's' });

      // Act
      const result = await target.healthy();

      // Assert
      expect(result).toEqual({ healthy: true, message: 'connected' });
    });

    it('returns unreachable when getSystemInfo throws — never rethrows', async () => {
      // Arrange
      await target.signalCoordinator('light', { session_id: 's' });
      mockClient.connection.workflowService.getSystemInfo.mockRejectedValueOnce(new Error('rpc closed'));

      // Act
      const result = await target.healthy();

      // Assert
      expect(result).toEqual({ healthy: false, message: 'unreachable: rpc closed' });
    });

    it('returns unreachable: timeout when getSystemInfo hangs past the 2 s budget', async () => {
      // Arrange — pre-connect via a signal, then make getSystemInfo never resolve.
      await target.signalCoordinator('light', { session_id: 's' });
      mockClient.connection.workflowService.getSystemInfo.mockImplementationOnce(() => new Promise(() => undefined));

      // Act — wait for the real 2 s budget to elapse. Jest test timeout is
      // increased for this single test to accommodate the sleep without
      // adopting fake timers (fake timers double-mock the Promise.race
      // setTimeout we use internally and break the race).
      const result = await target.healthy();

      // Assert — graceful Decision D: never throws.
      expect(result.healthy).toBe(false);
      expect(result.message).toMatch(/^unreachable: timeout$/);
    }, 5_000);
  });

  describe('onApplicationShutdown — graceful drain (first-class invariant)', () => {
    it('closes the connection and clears the cached client', async () => {
      // Arrange — connect first via signal
      await target.signalCoordinator('light', { session_id: 's' });

      // Act
      await target.onApplicationShutdown();

      // Assert
      expect(mockClient.connection.close).toHaveBeenCalledTimes(1);
      // Subsequent healthy() probe should report not-connected
      const probe = await target.healthy();
      expect(probe).toEqual({ healthy: false, message: 'not-connected' });
    });

    it('is idempotent — second call is a no-op (no double close)', async () => {
      // Arrange
      await target.signalCoordinator('light', { session_id: 's' });

      // Act
      await target.onApplicationShutdown();
      await target.onApplicationShutdown();

      // Assert
      expect(mockClient.connection.close).toHaveBeenCalledTimes(1);
    });

    it('logs skipped { reason: neverConnected } when the lazy client never resolved', async () => {
      // Arrange
      const logSpy = jest.spyOn(Logger.prototype, 'log');

      // Act
      await target.onApplicationShutdown();

      // Assert
      expect(mockClient.connection.close).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'temporalClient.shutdown.skipped',
          reason: 'neverConnected',
        }),
      );
    });

    it('logs shutdown.failed but does NOT rethrow when connection.close() throws', async () => {
      // Arrange — connected client, but connection.close rejects
      await target.signalCoordinator('light', { session_id: 's' });
      mockClient.connection.close.mockRejectedValueOnce(new Error('transport already closed'));
      const warnSpy = jest.spyOn(Logger.prototype, 'warn');

      // Act + Assert — graceful: never rethrows
      await expect(target.onApplicationShutdown()).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(expect.objectContaining({ event: 'temporalClient.shutdown.failed' }));
      // Probe also reports not-connected after shutdown
      const probe = await target.healthy();
      expect(probe).toEqual({ healthy: false, message: 'not-connected' });
    });
  });
});
