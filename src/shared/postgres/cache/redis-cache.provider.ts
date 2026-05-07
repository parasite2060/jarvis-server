import { Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { createClient, type RedisClientType } from 'redis';
import type { QueryRunner } from 'typeorm';
import type { QueryResultCache } from 'typeorm/cache/QueryResultCache';
import type { QueryResultCacheOptions } from 'typeorm/cache/QueryResultCacheOptions';

export interface RedisCacheProviderOptions {
  host: string;
  port: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  connectTimeoutMs?: number;
}

export class RedisCacheProvider implements QueryResultCache {
  private readonly logger = new Logger(RedisCacheProvider.name);
  private readonly keyPrefix: string;
  private client?: RedisClientType;

  constructor(private readonly options: RedisCacheProviderOptions) {
    this.keyPrefix = options.keyPrefix ?? 'typeorm:cache:';
  }

  private buildKey(options: QueryResultCacheOptions): string {
    const raw =
      options.identifier ||
      createHash('sha256')
        .update(options.query ?? '')
        .digest('hex');
    return `${this.keyPrefix}${raw}`;
  }

  async connect(): Promise<void> {
    if (this.client?.isOpen) return;

    this.client = createClient({
      socket: {
        host: this.options.host,
        port: this.options.port,
        connectTimeout: this.options.connectTimeoutMs ?? 5000,
        reconnectStrategy: (retries) => Math.min(retries * 50, 2000),
      },
      password: this.options.password,
      database: this.options.db,
    }) as RedisClientType;

    this.client.on('error', (err) => this.logger.warn(`Redis cache error: ${err.message}`));
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    if (this.client?.isOpen) {
      await this.client.quit();
    }
    this.client = undefined;
  }

  async synchronize(_queryRunner?: QueryRunner): Promise<void> {}

  async getFromCache(options: QueryResultCacheOptions, _queryRunner?: QueryRunner): Promise<QueryResultCacheOptions | undefined> {
    if (!this.client?.isOpen) return undefined;
    const key = this.buildKey(options);
    try {
      const raw = await this.client.get(key);
      if (!raw) return undefined;
      return JSON.parse(raw) as QueryResultCacheOptions;
    } catch (err) {
      this.logger.warn(`Redis cache get failed for ${key}: ${(err as Error).message}`);
      return undefined;
    }
  }

  async storeInCache(options: QueryResultCacheOptions, _savedCache: QueryResultCacheOptions | undefined, _queryRunner?: QueryRunner): Promise<void> {
    if (!this.client?.isOpen) return;
    const key = this.buildKey(options);
    const ttlSeconds = Math.max(1, Math.ceil((options.duration ?? 1000) / 1000));
    try {
      await this.client.set(key, JSON.stringify(options), { EX: ttlSeconds });
    } catch (err) {
      this.logger.warn(`Redis cache set failed for ${key}: ${(err as Error).message}`);
    }
  }

  isExpired(_savedCache: QueryResultCacheOptions): boolean {
    return false;
  }

  async clear(_queryRunner?: QueryRunner): Promise<void> {
    if (!this.client?.isOpen) return;
    const pattern = `${this.keyPrefix}*`;
    try {
      for await (const key of this.client.scanIterator({ MATCH: pattern, COUNT: 100 })) {
        await this.client.del(key);
      }
    } catch (err) {
      this.logger.warn(`Redis cache clear failed: ${(err as Error).message}`);
    }
  }

  async remove(identifiers: string[], _queryRunner?: QueryRunner): Promise<void> {
    if (!this.client?.isOpen || identifiers.length === 0) return;
    const keys = identifiers.map((id) => `${this.keyPrefix}${id}`);
    try {
      await this.client.del(keys);
    } catch (err) {
      this.logger.warn(`Redis cache remove failed: ${(err as Error).message}`);
    }
  }
}
