/**
 * Idempotent `pgvector` extension migration (Story 13.2 / Task 8).
 *
 * `CREATE EXTENSION IF NOT EXISTS vector`. The production homelab Postgres
 * already has the extension enabled (used by MemU's `memu` schema). The
 * current `jarvis` schema has NO `vector`-typed columns (verified via the
 * Story 13.2 Task 2 audit of `tables.py` + Alembic 0001–0009). This migration
 * exists for fresh installs and to keep future stories from needing a
 * separate extension-enabling migration.
 *
 * `down()` is intentionally a no-op — dropping the extension would break
 * MemU's vector usage in `memu` schema. Reverting must not destroy production
 * dependencies that live outside the `jarvis` schema.
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class Pgvector1746662400001 implements MigrationInterface {
  name = 'Pgvector1746662400001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // No-op. Do NOT drop the extension on revert — MemU's `memu` schema also
    // depends on `pgvector`, and reverting must not break unrelated workloads.
  }
}
