/**
 * Integration spec for `FileManifestRepositoryImpl` against real Postgres
 * (Story 13.6 / Task 6).
 *
 * Asserts CRUD + `syncFromManifest` against the real `jarvis.file_manifest`
 * table, including the soft-fail contract (errors logged + swallowed; never
 * propagated to the caller).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { FileManifestRepositoryImpl } from '../../src/shared/postgres/repository/file-manifest.repository.impl';
import { TranscriptSchema } from '../../src/shared/postgres/schema/transcript.schema';
import { DreamSchema } from '../../src/shared/postgres/schema/dream.schema';
import { DreamPhaseSchema } from '../../src/shared/postgres/schema/dream-phase.schema';
import { FileManifestSchema } from '../../src/shared/postgres/schema/file-manifest.schema';
import { ContextCacheSchema } from '../../src/shared/postgres/schema/context-cache.schema';
import { InitJarvis1746662400000 } from '../../src/shared/postgres/migration/1746662400000-init-jarvis';
import { Pgvector1746662400001 } from '../../src/shared/postgres/migration/1746662400001-pgvector';
import { DBConnections } from '../../src/shared/postgres/utils/constaint';
import { VaultFileInfo } from '../../src/shared/domain/repositories/file-manifest.repository.interface';

function makeFile(relativePath: string, contentHash: string, fileSize: number = 100): VaultFileInfo {
  return {
    relativePath,
    contentHash,
    fileSize,
    updatedAt: new Date('2026-05-08T13:00:00.000Z'),
  };
}

describe('FileManifestRepositoryImpl (integration)', () => {
  let dataSource: DataSource;
  let target: FileManifestRepositoryImpl;
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
    // Schema may already exist from a prior integration spec in the same run; recreate idempotently.
    await dataSource.query(`DROP SCHEMA IF EXISTS "jarvis" CASCADE`);
    await dataSource.query(`CREATE SCHEMA "jarvis"`);
    await dataSource.runMigrations();

    moduleRef = await Test.createTestingModule({
      providers: [
        FileManifestRepositoryImpl,
        {
          provide: getRepositoryToken(FileManifestSchema, DBConnections.INTERNAL),
          useValue: dataSource.getRepository(FileManifestSchema),
        },
      ],
    }).compile();
    target = moduleRef.get(FileManifestRepositoryImpl);
  }, 60000);

  afterAll(async () => {
    if (moduleRef) await moduleRef.close();
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  }, 30000);

  afterEach(async () => {
    await dataSource.query(`TRUNCATE jarvis.file_manifest CASCADE`);
  });

  it('upsertEntry inserts then updates by file_path against real Postgres', async () => {
    // Given an empty file_manifest table
    // When inserting then re-upserting the same path with a new hash
    const inserted = await target.upsertEntry({ filePath: 'SOUL.md', contentHash: 'h1', fileSize: 100 });
    const updated = await target.upsertEntry({ filePath: 'SOUL.md', contentHash: 'h2', fileSize: 200 });

    // Then the row is updated in place
    expect(updated.id).toBe(inserted.id);
    expect(updated.contentHash).toBe('h2');
    expect(updated.fileSize).toBe(200);
  });

  it('syncFromManifest applies insert + update + delete diff in one pass', async () => {
    // Given two existing rows
    await target.upsertEntry({ filePath: 'a.md', contentHash: 'old-ha', fileSize: 10 });
    await target.upsertEntry({ filePath: 'gone.md', contentHash: 'hg', fileSize: 10 });

    // When syncing a manifest that mutates a, removes gone, and adds new.md
    await target.syncFromManifest([makeFile('a.md', 'new-ha', 20), makeFile('new.md', 'hn', 30)]);

    // Then the table reflects the new state
    const rows = await dataSource.query(`SELECT file_path, content_hash, file_size FROM jarvis.file_manifest ORDER BY file_path`);
    expect(rows).toEqual([
      { file_path: 'a.md', content_hash: 'new-ha', file_size: 20 },
      { file_path: 'new.md', content_hash: 'hn', file_size: 30 },
    ]);
  });

  it('syncFromManifest soft-fails (resolves) on internal errors', async () => {
    // Given an invalid file_path that violates the column-length constraint (varchar(500))
    const oversized = 'x'.repeat(600);

    // When syncing a manifest with the oversized path
    // Then the call resolves without rethrowing (soft-fail contract)
    await expect(target.syncFromManifest([makeFile(oversized, 'h')])).resolves.toBeUndefined();
  });
});
