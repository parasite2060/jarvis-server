/**
 * Typed wrapper around `@nestjs/cache-manager` — Story 13.5 / Q1.
 *
 * Centralises the single cache key + 30-min TTL invariants. Use cases inject
 * `ContextCacheService` (NOT `Cache` directly) so the cache wiring is the
 * service's secret — swap stores or partition keys without touching call sites.
 *
 * Cache key per Q5 — single global `'context:assembled'` (single-user system,
 * no vault-version-hash). Mirrors Python `context_cache.py` `_cache["context"]`.
 *
 * `cache-manager` v7 `Cache` interface: `get<T>`, `set<T>(key, value, ttl?)`,
 * `del(key)`. TTL is in milliseconds.
 */
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { Cache } from 'cache-manager';

export interface CachedContext {
  context: string;
  assembled_at: string;
}

const CACHE_KEY = 'context:assembled';
const TTL_MS = 30 * 60 * 1000;

@Injectable()
export class ContextCacheService {
  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

  async get(): Promise<CachedContext | null> {
    const cached = await this.cacheManager.get<CachedContext>(CACHE_KEY);
    return cached ?? null;
  }

  async set(content: string, assembledAt: string): Promise<void> {
    await this.cacheManager.set<CachedContext>(CACHE_KEY, { context: content, assembled_at: assembledAt }, TTL_MS);
  }

  async clear(): Promise<void> {
    await this.cacheManager.del(CACHE_KEY);
  }
}
