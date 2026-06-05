/**
 * ContextCache entity (Story 13.2 / Task 3).
 *
 * POTO mirror of `jarvis.context_cache`. The Postgres table exists for MC4
 * schema parity only — Q5 resolved 2026-05-07: context cache stays in-memory
 * (`@nestjs/cache-manager`) per architecture §6.6. NO repository interface or
 * implementation is created in 13.2 or any 13.x story; the table sits idle
 * post-cutover. The entity is kept so future stories that decide to back the
 * cache with Postgres have a starting POTO.
 */
export class ContextCache {
  id!: number;
  cacheKey!: string;
  content!: string;
  contentHash?: string | null;
  expiresAt!: Date;
  createdAt!: Date;

  constructor(init?: Partial<ContextCache>) {
    Object.assign(this, init);
  }
}
