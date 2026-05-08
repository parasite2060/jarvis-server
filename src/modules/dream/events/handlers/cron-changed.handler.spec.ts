/**
 * Unit tests for `CronChangedEventsHandler` (Story 13.13).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { CronChangedEventsHandler } from './cron-changed.handler';
import { CronChangedEvent, CronChangedEventPayload } from 'src/modules/config/events/cron-changed.event';
import { TemporalClientService } from 'src/shared/temporal/temporal-client.service';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';

describe('CronChangedEventsHandler', () => {
  let target: CronChangedEventsHandler;
  let mockTemporalClient: DeepMocked<TemporalClientService>;

  beforeEach(async () => {
    mockTemporalClient = createMock<TemporalClientService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [CronChangedEventsHandler, { provide: TemporalClientService, useValue: mockTemporalClient }],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(CronChangedEventsHandler);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("maps kind='deepDream' to scheduleId='deep-dream-nightly' and calls updateSchedule", async () => {
    // Act
    await target.handle(new CronChangedEvent(new CronChangedEventPayload('deepDream', '0 20 * * *', '0 21 * * *')));

    // Assert
    expect(mockTemporalClient.updateSchedule).toHaveBeenCalledWith('deep-dream-nightly', '0 21 * * *');
  });

  it("maps kind='weeklyReview' to scheduleId='weekly-review' and calls updateSchedule", async () => {
    // Act
    await target.handle(new CronChangedEvent(new CronChangedEventPayload('weeklyReview', '0 20 * * 0', '0 22 * * 0')));

    // Assert
    expect(mockTemporalClient.updateSchedule).toHaveBeenCalledWith('weekly-review', '0 22 * * 0');
  });

  it('swallows errors from updateSchedule (Q13 fire-and-forget — self-heals on next boot)', async () => {
    // Arrange
    mockTemporalClient.updateSchedule.mockRejectedValue(new Error('Temporal unreachable'));

    // Act
    await expect(target.handle(new CronChangedEvent(new CronChangedEventPayload('deepDream', '0 20 * * *', '0 21 * * *')))).resolves.toBeUndefined();

    // Assert — error did NOT re-throw; updateSchedule was called once
    expect(mockTemporalClient.updateSchedule).toHaveBeenCalledTimes(1);
  });
});
