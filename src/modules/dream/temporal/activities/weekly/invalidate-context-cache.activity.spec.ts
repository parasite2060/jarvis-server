/**
 * Unit tests for `WeeklyInvalidateContextCacheActivity` (Story 13.10.5 / Q4 decomposition).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { CommandBus } from '@nestjs/cqrs';
import { WeeklyInvalidateContextCacheActivity } from './invalidate-context-cache.activity';
import { InvalidateContextCacheCommand } from 'src/modules/context/commands/invalidate-context-cache.command';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { ErrorCode } from 'src/utils/error.code';

describe('WeeklyInvalidateContextCacheActivity', () => {
  let target: WeeklyInvalidateContextCacheActivity;
  let mockCommandBus: DeepMocked<CommandBus>;

  beforeEach(async () => {
    mockCommandBus = createMock<CommandBus>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [WeeklyInvalidateContextCacheActivity, { provide: CommandBus, useValue: mockCommandBus }],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(WeeklyInvalidateContextCacheActivity);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('dispatches InvalidateContextCacheCommand with weekly-review-completed reason', async () => {
    // Act
    await target.invalidateContextCache({ dream_id: 20 });

    // Assert
    expect(mockCommandBus.execute).toHaveBeenCalledTimes(1);
    const cmd = mockCommandBus.execute.mock.calls[0]![0] as InvalidateContextCacheCommand;
    expect(cmd).toBeInstanceOf(InvalidateContextCacheCommand);
    expect(cmd.payload.reason).toBe('weekly-review-completed');
    expect(cmd.payload.timestamp).toBeInstanceOf(Date);
  });

  it('throws WEEKLY_REVIEW_INVALIDATE_CACHE_FAILED on CommandBus error', async () => {
    // Arrange
    mockCommandBus.execute.mockRejectedValue(new Error('bus down'));

    // Act
    const promise = target.invalidateContextCache({ dream_id: 21 });

    // Assert
    await expect(promise).rejects.toMatchObject({ code: ErrorCode.WEEKLY_REVIEW_INVALIDATE_CACHE_FAILED });
  });
});
