/**
 * Unit spec for TriggerDeepDreamUseCase (Story 13.14 extension).
 *
 * Covers:
 * - Manual call with sourceDateIso → signal payload includes source_date_iso
 * - Manual call with sourceDateIso null → source_date_iso is null in signal
 * - Auto/schedule call (no sourceDateIso arg) → source_date_iso is null (backwards compat)
 * - Signal payload uses snake_case keys (MC3 frozen)
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Logger } from '@nestjs/common';
import { TriggerDeepDreamUseCase, TriggerDeepDreamInput } from './trigger-deep-dream.usecase';
import { TemporalClientService } from 'src/shared/temporal/temporal-client.service';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';

describe('TriggerDeepDreamUseCase', () => {
  let target: TriggerDeepDreamUseCase;
  let mockTemporal: DeepMocked<TemporalClientService>;
  let logSpy: jest.SpyInstance;

  beforeEach(async () => {
    mockTemporal = createMock<TemporalClientService>();
    const module: TestingModule = await Test.createTestingModule({
      providers: [TriggerDeepDreamUseCase, { provide: TemporalClientService, useValue: mockTemporal }],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(TriggerDeepDreamUseCase);
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('manual with sourceDateIso — signal includes source_date_iso key (AC #3)', async () => {
    const input: TriggerDeepDreamInput = {
      targetDate: '2026-04-20',
      trigger: 'manual-backfill',
      sourceDateIso: '2026-04-20',
    };

    await target.execute(input);

    expect(mockTemporal.signalCoordinator).toHaveBeenCalledTimes(1);
    expect(mockTemporal.signalCoordinator).toHaveBeenCalledWith('deep', {
      target_date: '2026-04-20',
      trigger: 'manual-backfill',
      source_date_iso: '2026-04-20',
    });
  });

  it('manual without sourceDateIso (null) — source_date_iso is null in signal', async () => {
    const input: TriggerDeepDreamInput = {
      targetDate: '2026-05-09',
      trigger: 'manual',
      sourceDateIso: null,
    };

    await target.execute(input);

    expect(mockTemporal.signalCoordinator).toHaveBeenCalledWith('deep', {
      target_date: '2026-05-09',
      trigger: 'manual',
      source_date_iso: null,
    });
  });

  it('auto/schedule call (sourceDateIso omitted) — source_date_iso defaults to null (backwards compat with 13.13)', async () => {
    // No sourceDateIso field at all — mimics the schedule path calling via
    // signalCoordinator directly, but also tests the use case path when
    // sourceDateIso is undefined (not explicitly null).
    const input: TriggerDeepDreamInput = {
      targetDate: '2026-05-08',
      trigger: 'auto',
      // sourceDateIso omitted
    };

    await target.execute(input);

    // sourceDateIso defaults to null in the use case body
    expect(mockTemporal.signalCoordinator).toHaveBeenCalledWith('deep', {
      target_date: '2026-05-08',
      trigger: 'auto',
      source_date_iso: null,
    });
  });

  it('logs event with sourceDateIso', async () => {
    const input: TriggerDeepDreamInput = {
      targetDate: '2026-04-20',
      trigger: 'manual-backfill',
      sourceDateIso: '2026-04-20',
    };

    await target.execute(input);

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'dream.triggerDeep.dispatch',
        targetDate: '2026-04-20',
        trigger: 'manual-backfill',
        sourceDateIso: '2026-04-20',
      }),
    );
  });

  it('defaults trigger to manual when omitted', async () => {
    const input: TriggerDeepDreamInput = {
      targetDate: '2026-05-08',
      // trigger omitted
      sourceDateIso: null,
    };

    await target.execute(input);

    expect(mockTemporal.signalCoordinator).toHaveBeenCalledWith('deep', {
      target_date: '2026-05-08',
      trigger: 'manual',
      source_date_iso: null,
    });
  });
});
