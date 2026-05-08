/**
 * Unit tests for `DeepInvalidateContextCacheActivity` (Story 13.10.5 / Q4 decomposition).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { CommandBus } from '@nestjs/cqrs';
import { DeepInvalidateContextCacheActivity } from './invalidate-context-cache.activity';
import { InvalidateContextCacheCommand } from 'src/modules/context/commands/invalidate-context-cache.command';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';

describe('DeepInvalidateContextCacheActivity', () => {
  let target: DeepInvalidateContextCacheActivity;
  let mockCommandBus: DeepMocked<CommandBus>;

  beforeEach(async () => {
    mockCommandBus = createMock<CommandBus>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [DeepInvalidateContextCacheActivity, { provide: CommandBus, useValue: mockCommandBus }],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(DeepInvalidateContextCacheActivity);
  });

  it("dispatches InvalidateContextCacheCommand with reason 'deep-dream-completed'", async () => {
    // Arrange / Act
    await target.invalidateContextCache({ dream_id: 42 });

    // Assert
    expect(mockCommandBus.execute).toHaveBeenCalledTimes(1);
    const cmd = mockCommandBus.execute.mock.calls[0]![0] as InvalidateContextCacheCommand;
    expect(cmd).toBeInstanceOf(InvalidateContextCacheCommand);
    expect(cmd.payload.reason).toBe('deep-dream-completed');
    expect(cmd.payload.timestamp).toBeInstanceOf(Date);
  });
});
