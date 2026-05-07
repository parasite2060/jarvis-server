import * as Keyv from '@keyvhq/core';
import { createHash } from 'crypto';
import { MemoryCacheProvider } from './memory-cache.provider';

describe('MemoryCacheProvider', () => {
  let target: MemoryCacheProvider;
  let keyv: Keyv;

  beforeEach(() => {
    keyv = new Keyv({ ttl: 5000 });
    target = new MemoryCacheProvider('test:', keyv);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('connect / disconnect / synchronize', () => {
    it('should resolve without side effects', async () => {
      await expect(target.connect()).resolves.toBeUndefined();
      await expect(target.disconnect()).resolves.toBeUndefined();
      await expect(target.synchronize()).resolves.toBeUndefined();
    });
  });

  describe('storeInCache + getFromCache', () => {
    it('should round-trip a result by identifier with prefix applied', async () => {
      const options = { identifier: 'k1', query: 'SELECT 1', duration: 5000, result: [{ x: 1 }], time: Date.now() };

      await target.storeInCache(options, undefined);
      const got = await target.getFromCache(options);

      expect(got).toEqual({
        identifier: 'test:k1',
        duration: 5000,
        query: 'SELECT 1',
        result: [{ x: 1 }],
      });
    });

    it('should fall back to sha256 of query when identifier is empty', async () => {
      const query = 'SELECT 2';
      const expectedKey = `test:${createHash('sha256').update(query).digest('hex')}`;
      const options = { identifier: '', query, duration: 5000, result: [{ y: 2 }], time: Date.now() };

      await target.storeInCache(options, undefined);
      const got = await target.getFromCache(options);

      expect(got?.identifier).toBe(expectedKey);
      expect(got?.result).toEqual([{ y: 2 }]);
    });

    it('should return undefined when identifier is missing', async () => {
      const got = await target.getFromCache({ identifier: 'missing', query: '', duration: 0, result: null, time: 0 });

      expect(got).toBeUndefined();
    });
  });

  describe('clear', () => {
    it('should remove all stored entries', async () => {
      const a = { identifier: 'a', query: 'q', duration: 5000, result: [1], time: Date.now() };
      const b = { identifier: 'b', query: 'q', duration: 5000, result: [2], time: Date.now() };
      await target.storeInCache(a, undefined);
      await target.storeInCache(b, undefined);

      await target.clear();

      expect(await target.getFromCache(a)).toBeUndefined();
      expect(await target.getFromCache(b)).toBeUndefined();
    });
  });

  describe('remove', () => {
    it('should remove given identifiers, leaving others intact', async () => {
      const a = { identifier: 'a', query: 'q', duration: 5000, result: [1], time: Date.now() };
      const b = { identifier: 'b', query: 'q', duration: 5000, result: [2], time: Date.now() };
      await target.storeInCache(a, undefined);
      await target.storeInCache(b, undefined);

      await target.remove(['test:a']);

      expect(await target.getFromCache(a)).toBeUndefined();
      expect(await target.getFromCache(b)).toEqual({
        identifier: 'test:b',
        duration: 5000,
        query: 'q',
        result: [2],
      });
    });
  });

  describe('isExpired', () => {
    it('should always return false (TTL is enforced by underlying Keyv)', () => {
      const result = target.isExpired({ identifier: 'k', query: 'q', duration: 100, result: [], time: 0 });

      expect(result).toBe(false);
    });
  });

  describe('constructor defaults', () => {
    it('should default to empty prefix and a fresh Keyv when none provided', async () => {
      const defaultTarget = new MemoryCacheProvider();
      const options = { identifier: 'no-prefix', query: 'q', duration: 5000, result: ['v'], time: Date.now() };

      await defaultTarget.storeInCache(options, undefined);
      const got = await defaultTarget.getFromCache(options);

      expect(got?.identifier).toBe('no-prefix');
    });
  });
});
