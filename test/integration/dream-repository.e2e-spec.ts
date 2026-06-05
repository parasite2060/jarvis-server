/**
 * Integration spec for `DreamRepositoryImpl` against real Postgres
 * (Story 13.2 / Task 11 / AC #10).
 *
 * Asserts CRUD against `jarvis.dreams`, JSONB round-trip for `session_log`,
 * and FK enforcement on `transcript_id → jarvis.transcripts.id`.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Dream } from '../../src/shared/domain/entities/dream.entity';
import { DreamRepositoryImpl } from '../../src/shared/postgres/repository/dream.repository.impl';
import { TranscriptSchema } from '../../src/shared/postgres/schema/transcript.schema';
import { DreamSchema } from '../../src/shared/postgres/schema/dream.schema';
import { DreamPhaseSchema } from '../../src/shared/postgres/schema/dream-phase.schema';
import { FileManifestSchema } from '../../src/shared/postgres/schema/file-manifest.schema';
import { ContextCacheSchema } from '../../src/shared/postgres/schema/context-cache.schema';
import { InitJarvis1746662400000 } from '../../src/shared/postgres/migration/1746662400000-init-jarvis';
import { Pgvector1746662400001 } from '../../src/shared/postgres/migration/1746662400001-pgvector';
import { DBConnections } from '../../src/shared/postgres/utils/constaint';

describe('DreamRepositoryImpl (integration)', () => {
  let dataSource: DataSource;
  let target: DreamRepositoryImpl;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    dataSource = new DataSource({
      name: DBConnections.INTERNAL,
      type: 'postgres',
      host: process.env['DATABASE_HOST'] ?? 'localhost',
      port: Number(process.env['DATABASE_PORT'] ?? 5433),
      username: process.env['DATABASE_USER'] ?? 'postgres',
      password: process.env['DATABASE_PASSWORD'] ?? 'test123',
      database: process.env['DATABASE_NAME'] ?? 'e2e_test_db',
      schema: 'jarvis',
      entities: [TranscriptSchema, DreamSchema, DreamPhaseSchema, FileManifestSchema, ContextCacheSchema],
      migrations: [InitJarvis1746662400000, Pgvector1746662400001],
      migrationsRun: false,
      synchronize: false,
    });
    await dataSource.initialize();
    await dataSource.query(`DROP SCHEMA IF EXISTS "jarvis" CASCADE`);
    // Pre-create the `jarvis` schema so TypeORM can place the `migrations`
    // bookkeeping table before migration 0001 itself runs.
    await dataSource.query(`CREATE SCHEMA "jarvis"`);
    await dataSource.runMigrations();

    moduleRef = await Test.createTestingModule({
      providers: [
        DreamRepositoryImpl,
        {
          provide: getRepositoryToken(DreamSchema, DBConnections.INTERNAL),
          useValue: dataSource.getRepository(DreamSchema),
        },
      ],
    }).compile();
    target = moduleRef.get(DreamRepositoryImpl);
  }, 60000);

  afterAll(async () => {
    if (moduleRef) await moduleRef.close();
    if (dataSource?.isInitialized) {
      // Don't DROP SCHEMA — other e2e suites in the same run rely on the
      // schema staying available. Per-test cleanup is the `afterEach` TRUNCATE.
      await dataSource.destroy();
    }
  }, 30000);

  afterEach(async () => {
    await dataSource.query(`TRUNCATE jarvis.transcripts, jarvis.dreams CASCADE`);
  });

  it('createDream persists a row with autoincrement id and queued status default', async () => {
    // Given an empty `jarvis.dreams` table
    // When inserting
    const created = await target.createDream({ type: 'light', trigger: 'plugin' });

    // Then the row exists with the boilerplate-default `queued` status
    expect(created.id).toBeGreaterThan(0);
    expect(created.type).toBe('light');
    expect(created.trigger).toBe('plugin');
    expect(created.status).toBe('queued');
  });

  it('createDream with valid transcriptId honours the FK', async () => {
    // Given a transcript exists
    const transcript = await dataSource.getRepository(TranscriptSchema).save({ sessionId: 'sess-fk', rawContent: 'parent' });

    // When creating a dream that references it
    const dream = await target.createDream({
      type: 'light',
      trigger: 'plugin',
      transcriptId: transcript.id as number,
    });

    // Then the dream persists with the FK
    expect(dream.transcriptId).toBe(transcript.id);
  });

  it('createDream with invalid transcriptId fails the FK', async () => {
    // Given no matching transcript
    // When inserting
    // Then the FK constraint rejects
    await expect(
      target.createDream({
        type: 'light',
        trigger: 'plugin',
        transcriptId: 999_999,
      }),
    ).rejects.toThrow(/foreign key/i);
  });

  it('updateDreamOutcome updates outcome and status', async () => {
    // Given a queued dream
    const dream = await target.createDream({ type: 'light', trigger: 'plugin' });

    // When marking outcome + status
    await target.updateDreamOutcome(dream.id, 'wrote_files', 'completed');

    // Then both columns reflect the change
    const updated = await target.findById(dream.id);
    expect(updated?.outcome).toBe('wrote_files');
    expect(updated?.status).toBe('completed');
  });

  it('persistSessionLog round-trips JSONB identically', async () => {
    // Given a dream
    const dream = await target.createDream({ type: 'light', trigger: 'plugin' });
    const log: Record<string, unknown> = {
      conversationId: 'c-1',
      memories: [
        { kind: 'decision', text: 'use Bun', tags: ['tooling'] },
        { kind: 'lesson', text: 'avoid synchronous fs in hot path' },
      ],
      counts: { decisions: 1, lessons: 1 },
    };

    // When persisting the session log
    await target.persistSessionLog(dream.id, log);

    // Then the JSONB round-trips exactly
    const reloaded = await target.findById(dream.id);
    expect(reloaded?.sessionLog).toEqual(log);
  });

  it('findByDate returns only dreams whose createdAt falls on the requested UTC day', async () => {
    // Given three dreams across two UTC days
    const repo: Repository<Dream> = dataSource.getRepository(DreamSchema);
    const a = await target.createDream({ type: 'light', trigger: 'plugin' });
    const b = await target.createDream({ type: 'deep', trigger: 'cron' });
    const c = await target.createDream({ type: 'weekly', trigger: 'cron' });
    await repo.update({ id: a.id }, { createdAt: new Date('2026-05-07T03:00:00.000Z') });
    await repo.update({ id: b.id }, { createdAt: new Date('2026-05-07T20:00:00.000Z') });
    await repo.update({ id: c.id }, { createdAt: new Date('2026-05-08T00:30:00.000Z') });

    // When querying for 2026-05-07
    const result = await target.findByDate('2026-05-07');

    // Then only the two rows for that UTC day are returned
    expect(result.map((d) => d.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('findById returns null for missing rows', async () => {
    // When asking for a non-existent id
    const result = await target.findById(999_999);

    // Then the repo returns null (not throws)
    expect(result).toBeNull();
  });

  // Story 13.5 / Q9 — context module's health-summary integration relies on this.
  it('findLatestCompletedDeep returns the latest completed deep dream by completed_at DESC', async () => {
    // Given two completed deep dreams + one light dream + one queued deep dream
    const repo: Repository<Dream> = dataSource.getRepository(DreamSchema);
    const olderDeep = await target.createDream({ type: 'deep', trigger: 'cron' });
    await target.updateDreamOutcome(olderDeep.id, 'wrote_files', 'completed');
    const newerDeep = await target.createDream({ type: 'deep', trigger: 'cron' });
    await target.updateDreamOutcome(newerDeep.id, 'wrote_files', 'completed');
    await target.createDream({ type: 'light', trigger: 'plugin' }); // ignored — wrong type
    await target.createDream({ type: 'deep', trigger: 'cron' }); // ignored — queued
    await repo.update({ id: olderDeep.id }, { completedAt: new Date('2026-05-01T00:00:00.000Z') });
    await repo.update({ id: newerDeep.id }, { completedAt: new Date('2026-05-08T00:00:00.000Z') });

    // When asking for the latest completed deep dream
    const result = await target.findLatestCompletedDeep();

    // Then the repo returns the most recent completed deep dream
    expect(result?.id).toBe(newerDeep.id);
  });
});
