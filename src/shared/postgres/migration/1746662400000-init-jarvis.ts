/**
 * Jarvis schema baseline migration (Story 13.2 / Task 7).
 *
 * DO NOT MODIFY THIS FILE — any subsequent schema change goes in a NEW
 * `000N-...ts` migration. This file is a snapshot of the cumulative Alembic
 * state in the Python `jarvis-server` (revisions 0001 through 0009 in
 * `components/jarvis-server/alembic/versions/`) and the canonical declarative
 * source `components/jarvis-server/app/models/tables.py`. MC4 mandates
 * column-equivalence with the production schema; that contract is verified
 * by `pg_dump --schema-only --schema=jarvis --no-owner --no-acl` diff against
 * a fresh Alembic-migrated DB (per Story 13.2 AC #11 / Task 12).
 *
 * Column ordering reproduces the Alembic upgrade history (Postgres preserves
 * physical order). Tables are created without inter-table FKs first to avoid
 * the circular `transcripts.light_dream_id ↔ dreams.transcript_id` ordering
 * hazard; the three FKs are added at the end via `ALTER TABLE ADD CONSTRAINT`.
 *
 * Constraint names match Alembic verbatim (Nuance 1 — strict parity):
 *   - `fk_transcripts_light_dream_id` (named in 0001)
 *   - `fk_dreams_transcript_id`        (named in 0001)
 *   - `dream_phases_dream_id_fkey`     (auto-named by Postgres in 0004 —
 *      Alembic's `sa.ForeignKey(...)` without `name=` falls through to the
 *      Postgres default `<table>_<column>_fkey`)
 *   - `uq_file_manifest_file_path` / `uq_context_cache_cache_key` (named in 0001)
 *   - `<table>_pkey`                   (auto-named by Postgres for every PK)
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitJarvis1746662400000 implements MigrationInterface {
  name = 'InitJarvis1746662400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "jarvis"`);

    // --- jarvis.dreams (Alembic 0001 + 0003 + 0007 + 0008) -------------------
    await queryRunner.query(`
      CREATE TABLE "jarvis"."dreams" (
        "id" SERIAL NOT NULL,
        "type" VARCHAR(20) NOT NULL,
        "trigger" VARCHAR(20) NOT NULL,
        "status" VARCHAR(50) NOT NULL DEFAULT 'queued',
        "transcript_id" INTEGER,
        "input_summary" TEXT,
        "output_raw" TEXT,
        "files_modified" JSONB,
        "git_branch" VARCHAR(255),
        "git_pr_url" VARCHAR(500),
        "git_pr_status" VARCHAR(50),
        "error_message" TEXT,
        "duration_ms" INTEGER,
        "started_at" TIMESTAMP WITH TIME ZONE,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "input_tokens" INTEGER,
        "output_tokens" INTEGER,
        "total_tokens" INTEGER,
        "tool_calls" INTEGER,
        "session_log" JSONB,
        "outcome" VARCHAR(30),
        CONSTRAINT "dreams_pkey" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "ix_dreams_type" ON "jarvis"."dreams" ("type")`);
    await queryRunner.query(`CREATE INDEX "ix_dreams_status" ON "jarvis"."dreams" ("status")`);
    await queryRunner.query(`CREATE INDEX "ix_dreams_created_at" ON "jarvis"."dreams" ("created_at")`);

    // --- jarvis.transcripts (Alembic 0001 + 0002 + 0005 + 0006) -------------
    await queryRunner.query(`
      CREATE TABLE "jarvis"."transcripts" (
        "id" SERIAL NOT NULL,
        "session_id" VARCHAR(255) NOT NULL,
        "project" VARCHAR(255),
        "raw_content" TEXT NOT NULL,
        "parsed_text" TEXT,
        "token_count" INTEGER,
        "status" VARCHAR(50) NOT NULL DEFAULT 'received',
        "light_dream_id" INTEGER,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "source" VARCHAR(50),
        "is_continuation" BOOLEAN NOT NULL DEFAULT false,
        "segment_start_line" INTEGER NOT NULL DEFAULT 0,
        "segment_end_line" INTEGER NOT NULL DEFAULT 0,
        "last_processed_line" INTEGER NOT NULL DEFAULT 0,
        CONSTRAINT "transcripts_pkey" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "ix_transcripts_session_id" ON "jarvis"."transcripts" ("session_id")`);
    await queryRunner.query(`CREATE INDEX "ix_transcripts_status" ON "jarvis"."transcripts" ("status")`);
    await queryRunner.query(`CREATE INDEX "ix_transcripts_created_at" ON "jarvis"."transcripts" ("created_at")`);
    await queryRunner.query(`CREATE INDEX "ix_transcripts_session_source" ON "jarvis"."transcripts" ("session_id", "source")`);

    // --- jarvis.dream_phases (Alembic 0004) ---------------------------------
    await queryRunner.query(`
      CREATE TABLE "jarvis"."dream_phases" (
        "id" SERIAL NOT NULL,
        "dream_id" INTEGER NOT NULL,
        "phase" VARCHAR(50) NOT NULL,
        "status" VARCHAR(50) NOT NULL DEFAULT 'processing',
        "run_prompt" TEXT,
        "output_json" JSONB,
        "conversation_history" JSONB,
        "input_tokens" INTEGER,
        "output_tokens" INTEGER,
        "total_tokens" INTEGER,
        "tool_calls" INTEGER,
        "duration_ms" INTEGER,
        "started_at" TIMESTAMP WITH TIME ZONE,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "error_message" TEXT,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "dream_phases_pkey" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "ix_dream_phases_dream_id" ON "jarvis"."dream_phases" ("dream_id")`);
    await queryRunner.query(`CREATE INDEX "ix_dream_phases_phase" ON "jarvis"."dream_phases" ("phase")`);

    // --- jarvis.file_manifest (Alembic 0001) --------------------------------
    await queryRunner.query(`
      CREATE TABLE "jarvis"."file_manifest" (
        "id" SERIAL NOT NULL,
        "file_path" VARCHAR(500) NOT NULL,
        "content_hash" VARCHAR(64) NOT NULL,
        "file_size" INTEGER,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "file_manifest_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "uq_file_manifest_file_path" UNIQUE ("file_path")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "ix_file_manifest_file_path" ON "jarvis"."file_manifest" ("file_path")`);

    // --- jarvis.context_cache (Alembic 0001) --------------------------------
    await queryRunner.query(`
      CREATE TABLE "jarvis"."context_cache" (
        "id" SERIAL NOT NULL,
        "cache_key" VARCHAR(100) NOT NULL,
        "content" TEXT NOT NULL,
        "content_hash" VARCHAR(64),
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "context_cache_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "uq_context_cache_cache_key" UNIQUE ("cache_key")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "ix_context_cache_cache_key" ON "jarvis"."context_cache" ("cache_key")`);
    await queryRunner.query(`CREATE INDEX "ix_context_cache_expires_at" ON "jarvis"."context_cache" ("expires_at")`);

    // --- FKs (added after both ends exist) ----------------------------------
    await queryRunner.query(`
      ALTER TABLE "jarvis"."transcripts"
        ADD CONSTRAINT "fk_transcripts_light_dream_id"
        FOREIGN KEY ("light_dream_id") REFERENCES "jarvis"."dreams" ("id")
    `);
    await queryRunner.query(`
      ALTER TABLE "jarvis"."dreams"
        ADD CONSTRAINT "fk_dreams_transcript_id"
        FOREIGN KEY ("transcript_id") REFERENCES "jarvis"."transcripts" ("id")
    `);
    await queryRunner.query(`
      ALTER TABLE "jarvis"."dream_phases"
        ADD CONSTRAINT "dream_phases_dream_id_fkey"
        FOREIGN KEY ("dream_id") REFERENCES "jarvis"."dreams" ("id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop FKs first to break the circular dependency.
    await queryRunner.query(`ALTER TABLE "jarvis"."dream_phases" DROP CONSTRAINT "dream_phases_dream_id_fkey"`);
    await queryRunner.query(`ALTER TABLE "jarvis"."dreams" DROP CONSTRAINT "fk_dreams_transcript_id"`);
    await queryRunner.query(`ALTER TABLE "jarvis"."transcripts" DROP CONSTRAINT "fk_transcripts_light_dream_id"`);

    // Drop tables in reverse-dependency order.
    await queryRunner.query(`DROP TABLE "jarvis"."context_cache"`);
    await queryRunner.query(`DROP TABLE "jarvis"."file_manifest"`);
    await queryRunner.query(`DROP TABLE "jarvis"."dream_phases"`);
    await queryRunner.query(`DROP TABLE "jarvis"."transcripts"`);
    await queryRunner.query(`DROP TABLE "jarvis"."dreams"`);

    // Drop the schema last (CASCADE handles any leftover objects).
    await queryRunner.query(`DROP SCHEMA IF EXISTS "jarvis" CASCADE`);
  }
}
