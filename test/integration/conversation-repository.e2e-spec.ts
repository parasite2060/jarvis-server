/**
 * Integration spec for `ConversationRepositoryImpl` against real Postgres
 * (Story 13.2 / Task 11 / AC #10).
 *
 * Boots a slim TestingModule wired to the e2e Postgres from
 * `docker-compose.e2e.yml`, runs the Jarvis migrations explicitly, and
 * exercises every repository method against the real `jarvis.transcripts`
 * table. AAA / GWT comments per testing standards.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Conversation } from '../../src/shared/domain/entities/conversation.entity';
import { ConversationRepositoryImpl } from '../../src/shared/postgres/repository/conversation.repository.impl';
import { TranscriptSchema } from '../../src/shared/postgres/schema/transcript.schema';
import { DreamSchema } from '../../src/shared/postgres/schema/dream.schema';
import { DreamPhaseSchema } from '../../src/shared/postgres/schema/dream-phase.schema';
import { FileManifestSchema } from '../../src/shared/postgres/schema/file-manifest.schema';
import { ContextCacheSchema } from '../../src/shared/postgres/schema/context-cache.schema';
import { InitJarvis1746662400000 } from '../../src/shared/postgres/migration/1746662400000-init-jarvis';
import { Pgvector1746662400001 } from '../../src/shared/postgres/migration/1746662400001-pgvector';
import { DBConnections } from '../../src/shared/postgres/utils/constaint';

describe('ConversationRepositoryImpl (integration)', () => {
  let dataSource: DataSource;
  let target: ConversationRepositoryImpl;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    // Given a fresh Postgres with the Jarvis migrations applied
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
    // The DataSource is configured with `schema: 'jarvis'`, so TypeORM places
    // the `migrations` bookkeeping table there. Migration 0001 creates the
    // schema itself, but the schema must exist BEFORE `runMigrations()` writes
    // its bookkeeping row — pre-create here.
    await dataSource.query(`CREATE SCHEMA "jarvis"`);
    await dataSource.runMigrations();

    moduleRef = await Test.createTestingModule({
      providers: [
        ConversationRepositoryImpl,
        {
          provide: getRepositoryToken(TranscriptSchema, DBConnections.INTERNAL),
          useValue: dataSource.getRepository(TranscriptSchema),
        },
      ],
    }).compile();
    target = moduleRef.get(ConversationRepositoryImpl);
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

  it('insertTranscript persists a row with autoincrement id and snake_case columns', async () => {
    // Given an empty `jarvis.transcripts` table
    // When inserting a transcript
    const created = await target.insertTranscript({
      sessionId: 'sess-int-1',
      rawContent: 'hello',
      source: 'plugin',
    });

    // Then the row exists with an autoincrement id and the expected columns
    expect(created.id).toBeGreaterThan(0);
    expect(created.sessionId).toBe('sess-int-1');
    expect(created.rawContent).toBe('hello');

    const directRows = await dataSource.query(
      `SELECT id, session_id, raw_content, source, status, last_processed_line FROM jarvis.transcripts WHERE id = $1`,
      [created.id],
    );
    expect(directRows).toHaveLength(1);
    expect(directRows[0].session_id).toBe('sess-int-1');
    expect(directRows[0].source).toBe('plugin');
    expect(directRows[0].status).toBe('received');
    expect(directRows[0].last_processed_line).toBe(0);
  });

  it('findBySessionId returns transcripts in createdAt order', async () => {
    // Given two transcripts for the same session
    await target.insertTranscript({ sessionId: 'sess-int-2', rawContent: 'first' });
    await target.insertTranscript({ sessionId: 'sess-int-2', rawContent: 'second' });

    // When querying by session
    const result = await target.findBySessionId('sess-int-2');

    // Then both rows are returned in insertion order
    expect(result.map((r) => r.rawContent)).toEqual(['first', 'second']);
  });

  it('setLastProcessedLine + getLastProcessedLine round-trip', async () => {
    // Given a transcript with lastProcessedLine=100
    await target.insertTranscript({
      sessionId: 'sess-int-3',
      rawContent: 'x',
      lastProcessedLine: 100,
    });

    // When updating the line marker
    await target.setLastProcessedLine('sess-int-3', 200);

    // Then the marker reads back as 200
    expect(await target.getLastProcessedLine('sess-int-3')).toBe(200);
  });

  it('findRecentBySession honours the time window', async () => {
    // Given two transcripts at t-90s and t-30s
    const repo: Repository<Conversation> = dataSource.getRepository(TranscriptSchema);
    const old = await target.insertTranscript({ sessionId: 'sess-int-4', rawContent: 'old' });
    const fresh = await target.insertTranscript({ sessionId: 'sess-int-4', rawContent: 'fresh' });
    await repo.update({ id: old.id }, { createdAt: new Date(Date.now() - 90_000) });
    await repo.update({ id: fresh.id }, { createdAt: new Date(Date.now() - 30_000) });

    // When asking for transcripts within 60s
    const result = await target.findRecentBySession('sess-int-4', 60_000);

    // Then only the t-30s row is returned
    expect(result.map((r) => r.rawContent)).toEqual(['fresh']);
  });

  it('inserting a transcript with an invalid lightDreamId fails the FK', async () => {
    // Given `light_dream_id` references a non-existent `dreams.id`
    // When inserting
    // Then the FK constraint rejects
    await expect(
      target.insertTranscript({
        sessionId: 'sess-int-5',
        rawContent: 'fk-violation',
        lightDreamId: 999_999,
      }),
    ).rejects.toThrow(/foreign key/i);
  });
});
