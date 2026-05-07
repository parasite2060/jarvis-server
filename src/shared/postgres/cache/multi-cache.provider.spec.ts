import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { QueryResultCache } from 'typeorm/cache/QueryResultCache';
import { CacheType } from './cache-type.enum';
import { MultiCacheProvider } from './multi-cache.provider';

describe('MultiCacheProvider', () => {
  let target: MultiCacheProvider;
  let mockRedisProvider: DeepMocked<QueryResultCache>;
  let mockMemoryProvider: DeepMocked<QueryResultCache>;

  beforeEach(() => {
    mockRedisProvider = createMock<QueryResultCache>();
    mockMemoryProvider = createMock<QueryResultCache>();

    target = new MultiCacheProvider([
      { type: CacheType.REDIS, provider: mockRedisProvider },
      { type: CacheType.INMEMORY, provider: mockMemoryProvider },
    ]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('connect', () => {
    it('should connect every provider in parallel', async () => {
      await target.connect();

      expect(mockRedisProvider.connect).toHaveBeenCalledTimes(1);
      expect(mockMemoryProvider.connect).toHaveBeenCalledTimes(1);
    });
  });

  describe('disconnect', () => {
    it('should disconnect every provider in parallel', async () => {
      await target.disconnect();

      expect(mockRedisProvider.disconnect).toHaveBeenCalledTimes(1);
      expect(mockMemoryProvider.disconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('synchronize', () => {
    it('should synchronize every provider', async () => {
      await target.synchronize();

      expect(mockRedisProvider.synchronize).toHaveBeenCalledTimes(1);
      expect(mockMemoryProvider.synchronize).toHaveBeenCalledTimes(1);
    });
  });

  describe('getFromCache', () => {
    it('should route to REDIS provider when identifier carries REDIS prefix and pass stripped key', async () => {
      const options = { identifier: 'REDIS:user:42', query: 'SELECT', duration: 1000, result: ['hit'], time: 0 };
      mockRedisProvider.getFromCache.mockResolvedValue({ identifier: 'user:42', query: 'SELECT', duration: 1000, result: ['hit'] });

      const result = await target.getFromCache(options);

      expect(result).toEqual({ identifier: 'user:42', query: 'SELECT', duration: 1000, result: ['hit'] });
      expect(mockRedisProvider.getFromCache).toHaveBeenCalledWith({ ...options, identifier: 'user:42' }, undefined);
      expect(mockMemoryProvider.getFromCache).not.toHaveBeenCalled();
    });

    it('should route to INMEMORY provider when identifier carries INMEMORY prefix', async () => {
      const options = { identifier: 'INMEMORY:k1', query: 'q', duration: 1000, result: null, time: 0 };
      mockMemoryProvider.getFromCache.mockResolvedValue(undefined);

      await target.getFromCache(options);

      expect(mockMemoryProvider.getFromCache).toHaveBeenCalledWith({ ...options, identifier: 'k1' }, undefined);
      expect(mockRedisProvider.getFromCache).not.toHaveBeenCalled();
    });

    it('should fall back to first provider when identifier has no recognized prefix', async () => {
      const options = { identifier: 'plain-key', query: 'q', duration: 1000, result: null, time: 0 };

      await target.getFromCache(options);

      expect(mockRedisProvider.getFromCache).toHaveBeenCalledWith({ ...options, identifier: 'plain-key' }, undefined);
      expect(mockMemoryProvider.getFromCache).not.toHaveBeenCalled();
    });

    it('should preserve multi-segment keys after stripping the type prefix', async () => {
      const options = { identifier: 'REDIS:scope:1:items:42', query: 'q', duration: 1000, result: null, time: 0 };

      await target.getFromCache(options);

      expect(mockRedisProvider.getFromCache).toHaveBeenCalledWith({ ...options, identifier: 'scope:1:items:42' }, undefined);
    });

    it('should return undefined when no provider matches the resolved type', async () => {
      const provider = new MultiCacheProvider([{ type: CacheType.INMEMORY, provider: mockMemoryProvider }]);

      const result = await provider.getFromCache({ identifier: 'REDIS:k', query: 'q', duration: 0, result: null, time: 0 });

      expect(result).toBeUndefined();
      expect(mockMemoryProvider.getFromCache).not.toHaveBeenCalled();
    });
  });

  describe('storeInCache', () => {
    it('should route by prefix and pass stripped key', async () => {
      const options = { identifier: 'REDIS:abc', query: 'q', duration: 1000, result: [1], time: 0 };

      await target.storeInCache(options, undefined);

      expect(mockRedisProvider.storeInCache).toHaveBeenCalledWith({ ...options, identifier: 'abc' }, undefined, undefined);
      expect(mockMemoryProvider.storeInCache).not.toHaveBeenCalled();
    });
  });

  describe('isExpired', () => {
    it('should delegate to the routed provider with stripped key', () => {
      mockRedisProvider.isExpired.mockReturnValue(true);

      const result = target.isExpired({ identifier: 'REDIS:k', query: 'q', duration: 0, result: null, time: 0 });

      expect(result).toBe(true);
      expect(mockRedisProvider.isExpired).toHaveBeenCalledWith(expect.objectContaining({ identifier: 'k' }));
    });

    it('should return false when no provider matches the resolved type', () => {
      const provider = new MultiCacheProvider([{ type: CacheType.INMEMORY, provider: mockMemoryProvider }]);

      const result = provider.isExpired({ identifier: 'REDIS:k', query: 'q', duration: 0, result: null, time: 0 });

      expect(result).toBe(false);
      expect(mockMemoryProvider.isExpired).not.toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('should clear every provider', async () => {
      await target.clear();

      expect(mockRedisProvider.clear).toHaveBeenCalledTimes(1);
      expect(mockMemoryProvider.clear).toHaveBeenCalledTimes(1);
    });
  });

  describe('remove', () => {
    it('should group identifiers by resolved type and call each provider once with its keys', async () => {
      await target.remove(['REDIS:r1', 'REDIS:r2', 'INMEMORY:m1']);

      expect(mockRedisProvider.remove).toHaveBeenCalledTimes(1);
      expect(mockRedisProvider.remove).toHaveBeenCalledWith(['r1', 'r2'], undefined);
      expect(mockMemoryProvider.remove).toHaveBeenCalledTimes(1);
      expect(mockMemoryProvider.remove).toHaveBeenCalledWith(['m1'], undefined);
    });

    it('should send unprefixed identifiers to the first provider with the original key', async () => {
      await target.remove(['plain-key', 'INMEMORY:m1']);

      expect(mockRedisProvider.remove).toHaveBeenCalledWith(['plain-key'], undefined);
      expect(mockMemoryProvider.remove).toHaveBeenCalledWith(['m1'], undefined);
    });

    it('should be a no-op when given an empty list', async () => {
      await target.remove([]);

      expect(mockRedisProvider.remove).not.toHaveBeenCalled();
      expect(mockMemoryProvider.remove).not.toHaveBeenCalled();
    });
  });
});
