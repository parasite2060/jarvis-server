import * as Keyv from '@keyvhq/core';
import { createHash } from 'crypto';
import { QueryRunner } from 'typeorm';
import { QueryResultCache } from 'typeorm/cache/QueryResultCache';
import { QueryResultCacheOptions } from 'typeorm/cache/QueryResultCacheOptions';

export class MemoryCacheProvider implements QueryResultCache {
  cache: Keyv;
  keyPrefix: string;

  constructor(prefix?: string, keyv?: Keyv) {
    this.cache = keyv ?? new Keyv({ ttl: 5000 });
    this.keyPrefix = prefix ?? '';
  }

  private generateIdentifier(query: string): string {
    return query && `${createHash('sha256').update(query).digest('hex')}`;
  }

  /**
   * Creates a connection with given cache provider.
   */
  async connect(): Promise<void> {}

  /**
   * Closes a connection with given cache provider.
   */
  async disconnect(): Promise<void> {}

  /**
   * Performs operations needs to be created during schema synchronization.
   */
  async synchronize(_queryRunner?: QueryRunner): Promise<void> {}

  /**
   * Caches given query result.
   */
  async getFromCache(options: QueryResultCacheOptions, _queryRunner?: QueryRunner): Promise<QueryResultCacheOptions | undefined> {
    const { identifier, query, duration } = options;
    const key = `${this.keyPrefix}${identifier || this.generateIdentifier(query ?? '')}`;
    const result = await this.cache.get(key);

    return (
      result && {
        identifier: key,
        duration,
        query,
        result,
      }
    );
  }

  /**
   * Stores given query result in the cache.
   */
  async storeInCache(options: QueryResultCacheOptions, _savedCache: QueryResultCacheOptions | undefined, _queryRunner?: QueryRunner): Promise<void> {
    const { identifier, query, duration, result } = options;
    const key = `${this.keyPrefix}${identifier || this.generateIdentifier(query ?? '')}`;
    await this.cache.set(key, result, duration);
  }

  /**
   * Checks if cache is expired or not.
   */
  isExpired(_savedCache: QueryResultCacheOptions): boolean {
    return false;
  }

  /**
   * Clears everything stored in the cache.
   */
  async clear(_queryRunner?: QueryRunner): Promise<void> {
    await this.cache.clear();
  }

  /**
   * Removes all cached results by given identifiers from cache.
   */
  async remove(identifiers: string[], _queryRunner?: QueryRunner): Promise<void> {
    await Promise.all(identifiers.map((x) => this.cache.delete(x)));
  }
}
