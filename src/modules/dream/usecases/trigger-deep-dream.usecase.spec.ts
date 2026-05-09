/**
 * Unit spec for TriggerDeepDreamUseCase (Story 13.14 extension).
 *
 * Covers:
 * - Manual call with sourceDateIso → signal payload includes source_date_iso
 * - Manual call with sourceDateIso null → source_date_iso is null in signal
 * - Auto/schedule call (no sourceDateIso arg) → source_date_iso is null (backwards compat)
 * - Signal payload uses snake_case keys (MC3 frozen)
 * - trigger defaults to 'manual' when omitted
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { TriggerDeepDreamUseCase, TriggerDeepDreamInput } from './trigger-deep-dream.usecase';
import { TemporalClientService } from 'src/shared/temporal/temporal-client.service';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';

describe('TriggerDeepDreamUseCase', () => {
  let target: TriggerDeepDreamUseCase;
  let mockTemporal: DeepMocked<TemporalClientService>;

  beforeEach(async () => {
    mockTemporal = createMock<TemporalClientService>();
    const module: TestingModule = await Test.createTestingModule({
      providers: [TriggerDeepDreamUseCase, { provide: TemporalClientService, useValue: mockTemporal }],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(TriggerDeepDreamUseCase);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should include source_date_iso in signal payload when sourceDateIso is provided', async () => {
    // Arrange
    const input: TriggerDeepDreamInput = {
      targetDate: '2026-04-20',
      trigger: 'manual-backfill',
      sourceDateIso: '2026-04-20',
    };

    // Act
    await target.execute(input);

    // Assert
    expect(mockTemporal.signalCoordinator).toHaveBeenCalledTimes(1);
    expect(mockTemporal.signalCoordinator).toHaveBeenCalledWith('deep', {
      target_date: '2026-04-20',
      trigger: 'manual-backfill',
      source_date_iso: '2026-04-20',
    });
  });

  it('should set source_date_iso to null in signal payload when sourceDateIso is null', async () => {
    // Arrange
    const input: TriggerDeepDreamInput = {
      targetDate: '2026-05-09',
      trigger: 'manual',
      sourceDateIso: null,
    };

    // Act
    await target.execute(input);

    // Assert
    expect(mockTemporal.signalCoordinator).toHaveBeenCalledWith('deep', {
      target_date: '2026-05-09',
      trigger: 'manual',
      source_date_iso: null,
    });
  });

  it('should default source_date_iso to null when sourceDateIso is omitted (schedule path backwards compat)', async () => {
    // Arrange
    const input: TriggerDeepDreamInput = {
      targetDate: '2026-05-08',
      trigger: 'auto',
      // sourceDateIso intentionally omitted — mimics schedule path
    };

    // Act
    await target.execute(input);

    // Assert
    expect(mockTemporal.signalCoordinator).toHaveBeenCalledWith('deep', {
      target_date: '2026-05-08',
      trigger: 'auto',
      source_date_iso: null,
    });
  });

  it('should default trigger to manual when trigger field is omitted', async () => {
    // Arrange
    const input: TriggerDeepDreamInput = {
      targetDate: '2026-05-08',
      sourceDateIso: null,
      // trigger intentionally omitted
    };

    // Act
    await target.execute(input);

    // Assert
    expect(mockTemporal.signalCoordinator).toHaveBeenCalledWith('deep', {
      target_date: '2026-05-08',
      trigger: 'manual',
      source_date_iso: null,
    });
  });
});
