import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { ContextCacheService } from '../../services/context-cache.service';
import { InvalidateContextCacheCommand, InvalidateContextCacheReason } from '../invalidate-context-cache.command';
import { InvalidateContextCacheHandler } from './invalidate-context-cache.handler';

describe('InvalidateContextCacheHandler', () => {
  let target: InvalidateContextCacheHandler;
  let mockCacheService: DeepMocked<ContextCacheService>;
  let logSpy: jest.SpyInstance;

  beforeEach(async () => {
    mockCacheService = createMock<ContextCacheService>();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [InvalidateContextCacheHandler, { provide: ContextCacheService, useValue: mockCacheService }],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = moduleRef.get(InvalidateContextCacheHandler);
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('happy path — clears the cache and logs context.cache.invalidated with Python-ISO timestamp', async () => {
    // Arrange
    const timestamp = new Date('2026-05-08T13:00:00.123Z');
    const command = new InvalidateContextCacheCommand({ reason: 'manual', timestamp });

    // Act
    await target.execute(command);

    // Assert
    expect(mockCacheService.clear).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'context.cache.invalidated',
        reason: 'manual',
        timestamp: '2026-05-08T13:00:00.123000+00:00',
      }),
    );
  });

  it.each<InvalidateContextCacheReason>(['light-dream-completed', 'deep-dream-completed', 'weekly-review-completed', 'manual'])(
    'logs the kebab-case reason verbatim — %s',
    async (reason) => {
      // Arrange
      const command = new InvalidateContextCacheCommand({ reason, timestamp: new Date() });

      // Act
      await target.execute(command);

      // Assert
      expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ reason }));
    },
  );

  it('does not throw on out-of-union reason values (defensive)', async () => {
    // Arrange — cast an unexpected value through the union to assert robustness.
    const command = new InvalidateContextCacheCommand({
      reason: 'unexpected' as InvalidateContextCacheReason,
      timestamp: new Date(),
    });

    // Act / Assert
    await expect(target.execute(command)).resolves.not.toThrow();
    expect(mockCacheService.clear).toHaveBeenCalledTimes(1);
  });
});
