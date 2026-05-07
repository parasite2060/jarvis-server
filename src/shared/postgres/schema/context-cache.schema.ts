import { EntitySchema } from 'typeorm';
import { ContextCache } from 'src/shared/domain/entities/context-cache.entity';

/**
 * `jarvis.context_cache` schema (Story 13.2 / Task 4).
 *
 * Mirrors `ContextCache` in `components/jarvis-server/app/models/tables.py`.
 * Present for MC4 byte-parity only — runtime cache is in-memory per
 * architecture §6.6 (Q5 resolved 2026-05-07).
 */
export const ContextCacheSchema = new EntitySchema<ContextCache>({
  name: 'ContextCache',
  schema: 'jarvis',
  tableName: 'context_cache',
  columns: {
    id: {
      type: 'integer',
      primary: true,
      generated: 'increment',
    },
    cacheKey: {
      name: 'cache_key',
      type: 'varchar',
      length: 100,
      nullable: false,
    },
    content: {
      name: 'content',
      type: 'text',
      nullable: false,
    },
    contentHash: {
      name: 'content_hash',
      type: 'varchar',
      length: 64,
      nullable: true,
    },
    expiresAt: {
      name: 'expires_at',
      type: 'timestamp with time zone',
      nullable: false,
    },
    createdAt: {
      name: 'created_at',
      type: 'timestamp with time zone',
      createDate: true,
    },
  },
  uniques: [{ name: 'uq_context_cache_cache_key', columns: ['cacheKey'] }],
  indices: [
    { name: 'ix_context_cache_cache_key', columns: ['cacheKey'], unique: true },
    { name: 'ix_context_cache_expires_at', columns: ['expiresAt'] },
  ],
});
