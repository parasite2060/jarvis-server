import { Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { createClient } from 'redis';
import { RedisCacheProvider, RedisCacheProviderOptions } from './redis-cache.provider';

jest.mock('redis', () => ({
  createClient: jest.fn(),
}));

interface MockRedisClient {
  isOpen: boolean;
  connect: jest.Mock;
  quit: jest.Mock;
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
  scanIterator: jest.Mock;
  on: jest.Mock;
}

function buildClient(): MockRedisClient {
  const client: MockRedisClient = {
    isOpen: false,
    connect: jest.fn().mockImplementation(async () => {
      client.isOpen = true;
    }),
    quit: jest.fn().mockImplementation(async () => {
      client.isOpen = false;
    }),
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    scanIterator: jest.fn(),
    on: jest.fn(),
  };
  return client;
}

const mockedCreateClient = createClient as unknown as jest.Mock;

describe('RedisCacheProvider', () => {
  let target: RedisCacheProvider;
  let mockClient: MockRedisClient;
  const baseOptions: RedisCacheProviderOptions = {
    host: 'localhost',
    port: 6380,
    password: 'secret',
    db: 1,
  };

  beforeEach(() => {
    mockClient = buildClient();
    mockedCreateClient.mockReturnValue(mockClient);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    target = new RedisCacheProvider(baseOptions);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('connect', () => {
    it('should create the client with mapped socket/auth options and register an error handler', async () => {
      await target.connect();

      expect(mockedCreateClient).toHaveBeenCalledTimes(1);
      const passed = mockedCreateClient.mock.calls[0]![0];
      expect(passed.socket.host).toBe('localhost');
      expect(passed.socket.port).toBe(6380);
      expect(passed.socket.connectTimeout).toBe(5000);
      expect(typeof passed.socket.reconnectStrategy).toBe('function');
      expect(passed.password).toBe('secret');
      expect(passed.database).toBe(1);
      expect(mockClient.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockClient.connect).toHaveBeenCalledTimes(1);
    });

    it('should honor a custom connectTimeoutMs', async () => {
      target = new RedisCacheProvider({ ...baseOptions, connectTimeoutMs: 1000 });

      await target.connect();

      expect(mockedCreateClient.mock.calls[0]![0].socket.connectTimeout).toBe(1000);
    });

    it('should be a no-op when the client is already open', async () => {
      await target.connect();
      mockedCreateClient.mockClear();
      mockClient.connect.mockClear();

      await target.connect();

      expect(mockedCreateClient).not.toHaveBeenCalled();
      expect(mockClient.connect).not.toHaveBeenCalled();
    });

    it('should produce a reconnect delay capped at 2000ms', async () => {
      await target.connect();
      const reconnectStrategy = mockedCreateClient.mock.calls[0]![0].socket.reconnectStrategy as (retries: number) => number;

      expect(reconnectStrategy(0)).toBe(0);
      expect(reconnectStrategy(10)).toBe(500);
      expect(reconnectStrategy(50)).toBe(2000);
      expect(reconnectStrategy(1000)).toBe(2000);
    });
  });

  describe('disconnect', () => {
    it('should quit the client and drop the reference when open', async () => {
      await target.connect();

      await target.disconnect();

      expect(mockClient.quit).toHaveBeenCalledTimes(1);
    });

    it('should be a no-op when the client was never connected', async () => {
      await target.disconnect();

      expect(mockClient.quit).not.toHaveBeenCalled();
    });
  });

  describe('synchronize', () => {
    it('should resolve without side effects', async () => {
      await expect(target.synchronize()).resolves.toBeUndefined();
    });
  });

  describe('getFromCache', () => {
    it('should return undefined when the client is not open', async () => {
      const result = await target.getFromCache({ identifier: 'k', query: 'q', duration: 1000, result: null, time: 0 });

      expect(result).toBeUndefined();
      expect(mockClient.get).not.toHaveBeenCalled();
    });

    it('should fetch by prefixed identifier and parse the stored JSON', async () => {
      await target.connect();
      const stored = { identifier: 'k1', query: 'SELECT', duration: 1000, result: [{ a: 1 }], time: 0 };
      mockClient.get.mockResolvedValue(JSON.stringify(stored));

      const result = await target.getFromCache({ identifier: 'k1', query: 'SELECT', duration: 1000, result: null, time: 0 });

      expect(mockClient.get).toHaveBeenCalledWith('typeorm:cache:k1');
      expect(result).toEqual(stored);
    });

    it('should hash the query when no identifier is provided', async () => {
      await target.connect();
      mockClient.get.mockResolvedValue(null);
      const query = 'SELECT 99';
      const expectedHash = createHash('sha256').update(query).digest('hex');

      await target.getFromCache({ identifier: '', query, duration: 1000, result: null, time: 0 });

      expect(mockClient.get).toHaveBeenCalledWith(`typeorm:cache:${expectedHash}`);
    });

    it('should return undefined when Redis returns null', async () => {
      await target.connect();
      mockClient.get.mockResolvedValue(null);

      const result = await target.getFromCache({ identifier: 'missing', query: 'q', duration: 1000, result: null, time: 0 });

      expect(result).toBeUndefined();
    });

    it('should swallow client errors and return undefined', async () => {
      await target.connect();
      mockClient.get.mockRejectedValue(new Error('boom'));

      const result = await target.getFromCache({ identifier: 'k', query: 'q', duration: 1000, result: null, time: 0 });

      expect(result).toBeUndefined();
    });

    it('should honor a custom keyPrefix', async () => {
      target = new RedisCacheProvider({ ...baseOptions, keyPrefix: 'app:' });
      await target.connect();
      mockClient.get.mockResolvedValue(null);

      await target.getFromCache({ identifier: 'k', query: 'q', duration: 1000, result: null, time: 0 });

      expect(mockClient.get).toHaveBeenCalledWith('app:k');
    });
  });

  describe('storeInCache', () => {
    it('should be a no-op when the client is not open', async () => {
      await target.storeInCache({ identifier: 'k', query: 'q', duration: 1000, result: [], time: 0 }, undefined);

      expect(mockClient.set).not.toHaveBeenCalled();
    });

    it('should set with EX expressed as ceiling of duration in seconds', async () => {
      await target.connect();
      const options = { identifier: 'k1', query: 'q', duration: 1500, result: [{ a: 1 }], time: 0 };

      await target.storeInCache(options, undefined);

      expect(mockClient.set).toHaveBeenCalledWith('typeorm:cache:k1', JSON.stringify(options), { EX: 2 });
    });

    it('should clamp very small durations to a 1-second floor', async () => {
      await target.connect();

      await target.storeInCache({ identifier: 'k', query: 'q', duration: 50, result: [], time: 0 }, undefined);

      expect(mockClient.set).toHaveBeenCalledWith('typeorm:cache:k', expect.any(String), { EX: 1 });
    });

    it('should default to 1-second TTL when duration is missing', async () => {
      await target.connect();

      await target.storeInCache({ identifier: 'k', query: 'q', duration: 0, result: [], time: 0 }, undefined);

      expect(mockClient.set).toHaveBeenCalledWith('typeorm:cache:k', expect.any(String), { EX: 1 });
    });

    it('should swallow client errors silently', async () => {
      await target.connect();
      mockClient.set.mockRejectedValue(new Error('redis down'));

      await expect(target.storeInCache({ identifier: 'k', query: 'q', duration: 1000, result: [], time: 0 }, undefined)).resolves.toBeUndefined();
    });
  });

  describe('isExpired', () => {
    it('should always return false (TTL is enforced server-side via EX)', () => {
      const result = target.isExpired({ identifier: 'k', query: 'q', duration: 1000, result: null, time: 0 });

      expect(result).toBe(false);
    });
  });

  describe('clear', () => {
    it('should be a no-op when the client is not open', async () => {
      await target.clear();

      expect(mockClient.scanIterator).not.toHaveBeenCalled();
    });

    it('should iterate matching keys and delete each one', async () => {
      await target.connect();
      mockClient.scanIterator.mockReturnValue(
        (async function* () {
          yield 'typeorm:cache:a';
          yield 'typeorm:cache:b';
        })(),
      );

      await target.clear();

      expect(mockClient.scanIterator).toHaveBeenCalledWith({ MATCH: 'typeorm:cache:*', COUNT: 100 });
      expect(mockClient.del).toHaveBeenCalledTimes(2);
      expect(mockClient.del).toHaveBeenNthCalledWith(1, 'typeorm:cache:a');
      expect(mockClient.del).toHaveBeenNthCalledWith(2, 'typeorm:cache:b');
    });

    it('should swallow scan errors silently', async () => {
      await target.connect();
      mockClient.scanIterator.mockImplementation(() => {
        throw new Error('scan failed');
      });

      await expect(target.clear()).resolves.toBeUndefined();
    });
  });

  describe('remove', () => {
    it('should be a no-op when the client is not open', async () => {
      await target.remove(['k1']);

      expect(mockClient.del).not.toHaveBeenCalled();
    });

    it('should be a no-op when given an empty list', async () => {
      await target.connect();

      await target.remove([]);

      expect(mockClient.del).not.toHaveBeenCalled();
    });

    it('should delete prefixed keys in a single call', async () => {
      await target.connect();

      await target.remove(['k1', 'k2']);

      expect(mockClient.del).toHaveBeenCalledTimes(1);
      expect(mockClient.del).toHaveBeenCalledWith(['typeorm:cache:k1', 'typeorm:cache:k2']);
    });

    it('should swallow del errors silently', async () => {
      await target.connect();
      mockClient.del.mockRejectedValue(new Error('redis down'));

      await expect(target.remove(['k'])).resolves.toBeUndefined();
    });
  });
});
