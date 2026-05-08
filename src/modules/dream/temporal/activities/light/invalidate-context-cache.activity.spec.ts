/**
 * Unit tests for `LightInvalidateContextCacheActivity` (Story 13.10.5 / Q4 decomposition).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { CommandBus } from '@nestjs/cqrs';
import { LightInvalidateContextCacheActivity } from './invalidate-context-cache.activity';
import { InvalidateContextCacheCommand } from 'src/modules/context/commands/invalidate-context-cache.command';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';

describe('LightInvalidateContextCacheActivity', () => {
  let target: LightInvalidateContextCacheActivity;
  let mockCommandBus: DeepMocked<CommandBus>;

  beforeEach(async () => {
    mockCommandBus = createMock<CommandBus>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [LightInvalidateContextCacheActivity, { provide: CommandBus, useValue: mockCommandBus }],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(LightInvalidateContextCacheActivity);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('dispatches InvalidateContextCacheCommand with light-dream-completed reason', async () => {
    // Arrange
    mockCommandBus.execute.mockResolvedValue(undefined);

    // Act
    await target.invalidateContextCache({ dream_id: 1 });

    // Assert
    const dispatched = mockCommandBus.execute.mock.calls[0]?.[0] as InvalidateContextCacheCommand;
    expect(dispatched).toBeInstanceOf(InvalidateContextCacheCommand);
    expect(dispatched.payload.reason).toBe('light-dream-completed');
    expect(dispatched.payload.timestamp).toBeInstanceOf(Date);
  });

  it('throws LIGHT_DREAM_INVALIDATE_CACHE_FAILED on dispatch error', async () => {
    // Arrange
    mockCommandBus.execute.mockRejectedValue(new Error('bus down'));

    // Act
    const promise = target.invalidateContextCache({ dream_id: 1 });

    // Assert
    await expect(promise).rejects.toBeInstanceOf(InternalException);
    await expect(promise).rejects.toMatchObject({ code: ErrorCode.LIGHT_DREAM_INVALIDATE_CACHE_FAILED });
  });
});
