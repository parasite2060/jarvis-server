import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Cache } from 'cache-manager';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { ContextCacheService } from './context-cache.service';

describe('ContextCacheService', () => {
  let target: ContextCacheService;
  let mockCacheManager: DeepMocked<Cache>;

  beforeEach(async () => {
    mockCacheManager = createMock<Cache>();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [ContextCacheService, { provide: CACHE_MANAGER, useValue: mockCacheManager }],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = moduleRef.get(ContextCacheService);
  });

  it('get returns null on cache miss (cache-manager returns undefined)', async () => {
    // Arrange
    mockCacheManager.get.mockResolvedValue(undefined);

    // Act
    const result = await target.get();

    // Assert
    expect(result).toBeNull();
    expect(mockCacheManager.get).toHaveBeenCalledWith('context:assembled');
  });

  it('get returns CachedContext on hit', async () => {
    // Arrange
    const cached = { context: 'hello', assembled_at: '2026-05-08T13:00:00.000000+00:00' };
    mockCacheManager.get.mockResolvedValue(cached);

    // Act
    const result = await target.get();

    // Assert
    expect(result).toEqual(cached);
  });

  it('set writes payload + 30-min TTL under the canonical key', async () => {
    // Arrange / Act
    await target.set('content', '2026-05-08T13:00:00.000000+00:00');

    // Assert
    expect(mockCacheManager.set).toHaveBeenCalledWith(
      'context:assembled',
      { context: 'content', assembled_at: '2026-05-08T13:00:00.000000+00:00' },
      30 * 60 * 1000,
    );
  });

  it('clear deletes the canonical key', async () => {
    // Arrange / Act
    await target.clear();

    // Assert
    expect(mockCacheManager.del).toHaveBeenCalledWith('context:assembled');
  });
});
