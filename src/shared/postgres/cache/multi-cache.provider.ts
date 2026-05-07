/* eslint-disable @typescript-eslint/no-explicit-any */
import { QueryRunner } from 'typeorm';
import { QueryResultCache } from 'typeorm/cache/QueryResultCache';
import { QueryResultCacheOptions } from 'typeorm/cache/QueryResultCacheOptions';
import { CacheType } from './cache-type.enum';

export type MultiCacheProviderItem = {
  type: CacheType;
  provider: QueryResultCache;
};

export class MultiCacheProvider implements QueryResultCache {
  private readonly cacheTypes = Object.values(CacheType);
  private readonly providerMap = new Map<CacheType, QueryResultCache>();
  private readonly providers: MultiCacheProviderItem[];

  constructor(providers: MultiCacheProviderItem[]) {
    this.providers = providers;
    for (const item of providers) {
      this.providerMap.set(item.type, item.provider);
    }
  }

  /**
   * Creates a connection with given cache provider.
   */
  async connect(): Promise<void> {
    await Promise.all(this.providers.map((x) => x.provider.connect()));
  }

  /**
   * Closes a connection with given cache provider.
   */
  async disconnect(): Promise<void> {
    await Promise.all(this.providers.map((x) => x.provider.disconnect()));
  }

  /**
   * Performs operations needs to be created during schema synchronization.
   */
  async synchronize(queryRunner?: QueryRunner): Promise<void> {
    await Promise.all(this.providers.map((x) => x.provider.synchronize(queryRunner)));
  }

  /**
   * Caches given query result.
   */
  async getFromCache(options: QueryResultCacheOptions, queryRunner?: QueryRunner): Promise<QueryResultCacheOptions | undefined> {
    const { type, key } = this.getCacheOptions(options.identifier);
    const provider = this.providerMap.get(type);
    if (provider) {
      return await provider.getFromCache({ ...options, identifier: key }, queryRunner);
    }

    return undefined;
  }

  /**
   * Stores given query result in the cache.
   */
  async storeInCache(options: QueryResultCacheOptions, savedCache: QueryResultCacheOptions | undefined, queryRunner?: QueryRunner): Promise<void> {
    const { type, key } = this.getCacheOptions(options.identifier);
    const provider = this.providerMap.get(type);
    if (provider) {
      return await provider.storeInCache({ ...options, identifier: key }, savedCache, queryRunner);
    }

    return undefined;
  }

  /**
   * Checks if cache is expired or not.
   */
  isExpired(savedCache: QueryResultCacheOptions): boolean {
    const { type, key } = this.getCacheOptions(savedCache.identifier!);
    const provider = this.providerMap.get(type);
    if (provider) {
      return provider.isExpired({ ...savedCache, identifier: key });
    }

    return false;
  }

  /**
   * Clears everything stored in the cache.
   */
  async clear(queryRunner?: QueryRunner): Promise<void> {
    await Promise.all(this.providers.map((x) => x.provider.clear(queryRunner)));
  }

  /**
   * Removes all cached results by given identifiers from cache.
   */
  async remove(identifiers: string[], queryRunner?: QueryRunner): Promise<void> {
    const cacheOptions = [];
    for (const identifier of identifiers) {
      cacheOptions.push(this.getCacheOptions(identifier));
    }

    const tasks = [];
    const groupOptions = this.groupBy(cacheOptions, 'type');
    for (const type in groupOptions) {
      const provider = this.providerMap.get(type as CacheType);
      if (provider) {
        tasks.push(
          provider.remove(
            groupOptions[type]!.map((x) => x.key),
            queryRunner,
          ),
        );
      }
    }

    await Promise.all(tasks);
  }

  private getCacheOptions(identifier: string | undefined): {
    type: CacheType;
    key: any;
  } {
    if (identifier) {
      const parts = identifier.split(':');
      if (parts.length > 1 && this.cacheTypes.includes(parts[0] as CacheType)) {
        return {
          type: parts[0] as CacheType,
          key: parts.slice(1).join(':'),
        };
      }

      return {
        type: this.providers[0]!.type,
        key: identifier,
      };
    }

    return {
      type: this.providers[0]!.type,
      key: '',
    };
  }

  private groupBy(xs: any[], key: string): Record<string, any[]> {
    return xs.reduce(function (rv, x) {
      (rv[x[key]] = rv[x[key]] || []).push(x);
      return rv;
    }, {});
  }
}
