/**
 * pg-mem unit specs for `FileManifestRepositoryImpl` — Story 13.6 / Task 6 (closes 13.2 deferred-work).
 *
 * pg-mem caveat — pg-mem does NOT model PostgreSQL custom schemas. The
 * production `FileManifestSchema` declares `schema: 'jarvis'`; for pg-mem
 * tests we clone the EntitySchema with the `schema` option stripped so tables
 * land in the default namespace. Real `jarvis.file_manifest` schema
 * verification is the integration spec at
 * `test/integration/file-manifest-repository.e2e-spec.ts`.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntitySchema } from 'typeorm';
import { createPgMemDataSource, PgMemTestHelper } from '../../../../test/helpers/pg-mem.helper';
import { FileManifestRepositoryImpl } from './file-manifest.repository.impl';
import { FileManifestSchema } from '../schema/file-manifest.schema';
import { FileManifestEntry } from 'src/shared/domain/entities/file-manifest-entry.entity';
import { VaultFileInfo } from 'src/shared/domain/repositories/file-manifest.repository.interface';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { DBConnections } from '../utils/constaint';

const PgMemFileManifestSchema = new EntitySchema<FileManifestEntry>({
  ...FileManifestSchema.options,
  schema: undefined,
});

function makeFile(relativePath: string, contentHash: string, fileSize: number = 10): VaultFileInfo {
  return {
    relativePath,
    contentHash,
    fileSize,
    updatedAt: new Date('2026-05-08T13:00:00.000Z'),
  };
}

describe('FileManifestRepositoryImpl', () => {
  let target: FileManifestRepositoryImpl;
  let dataSource: DataSource;
  let helper: PgMemTestHelper;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    dataSource = await createPgMemDataSource([PgMemFileManifestSchema]);
    helper = new PgMemTestHelper(dataSource);

    const repository = dataSource.getRepository(PgMemFileManifestSchema);

    moduleRef = await Test.createTestingModule({
      providers: [
        FileManifestRepositoryImpl,
        {
          provide: getRepositoryToken(FileManifestSchema, DBConnections.INTERNAL),
          useValue: repository,
        },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = moduleRef.get<FileManifestRepositoryImpl>(FileManifestRepositoryImpl);
  }, 60000);

  afterAll(async () => {
    await moduleRef?.close();
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    await helper.clearTable(PgMemFileManifestSchema);
  });

  describe('upsertEntry', () => {
    it('inserts a new row when path absent', async () => {
      // Act
      const result = await target.upsertEntry({ filePath: 'SOUL.md', contentHash: 'h1', fileSize: 100 });

      // Assert
      expect(result.id).toBeDefined();
      expect(result.filePath).toBe('SOUL.md');
      expect(result.contentHash).toBe('h1');
      expect(result.fileSize).toBe(100);
    });

    it('updates an existing row when path matches', async () => {
      // Arrange
      const inserted = await target.upsertEntry({ filePath: 'SOUL.md', contentHash: 'h1', fileSize: 100 });

      // Act
      const updated = await target.upsertEntry({ filePath: 'SOUL.md', contentHash: 'h2', fileSize: 200 });

      // Assert — same id; new hash + size.
      expect(updated.id).toBe(inserted.id);
      expect(updated.contentHash).toBe('h2');
      expect(updated.fileSize).toBe(200);
    });
  });

  describe('getAll', () => {
    it('returns every persisted row', async () => {
      // Arrange
      await target.upsertEntry({ filePath: 'a.md', contentHash: 'ha' });
      await target.upsertEntry({ filePath: 'b.md', contentHash: 'hb' });

      // Act
      const result = await target.getAll();

      // Assert
      expect(result.map((r) => r.filePath).sort()).toEqual(['a.md', 'b.md']);
    });
  });

  describe('getByPath', () => {
    it('returns the row when found', async () => {
      // Arrange
      await target.upsertEntry({ filePath: 'SOUL.md', contentHash: 'h1' });

      // Act
      const result = await target.getByPath('SOUL.md');

      // Assert
      expect(result?.filePath).toBe('SOUL.md');
    });

    it('returns null when missing', async () => {
      // Act
      const result = await target.getByPath('NOTHERE.md');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('deleteByPath', () => {
    it('removes the row identified by filePath', async () => {
      // Arrange
      await target.upsertEntry({ filePath: 'SOUL.md', contentHash: 'h1' });

      // Act
      await target.deleteByPath('SOUL.md');

      // Assert
      const result = await target.getByPath('SOUL.md');
      expect(result).toBeNull();
    });
  });

  describe('syncFromManifest', () => {
    it('inserts rows for paths absent from the table', async () => {
      // Arrange — empty table.

      // Act
      await target.syncFromManifest([makeFile('a.md', 'ha'), makeFile('b.md', 'hb')]);

      // Assert
      const all = await target.getAll();
      expect(all.map((r) => r.filePath).sort()).toEqual(['a.md', 'b.md']);
    });

    it('updates existing rows when content hash changes; skips unchanged hashes', async () => {
      // Arrange — seed with two rows.
      await target.upsertEntry({ filePath: 'a.md', contentHash: 'old-ha', fileSize: 10 });
      await target.upsertEntry({ filePath: 'b.md', contentHash: 'hb', fileSize: 10 });

      // Act — manifest has new hash for a.md; same hash for b.md.
      await target.syncFromManifest([makeFile('a.md', 'new-ha', 20), makeFile('b.md', 'hb', 10)]);

      // Assert
      const a = await target.getByPath('a.md');
      const b = await target.getByPath('b.md');
      expect(a?.contentHash).toBe('new-ha');
      expect(a?.fileSize).toBe(20);
      expect(b?.contentHash).toBe('hb');
    });

    it('deletes rows whose paths are absent from the manifest', async () => {
      // Arrange — seed with three rows; manifest only has two.
      await target.upsertEntry({ filePath: 'a.md', contentHash: 'ha' });
      await target.upsertEntry({ filePath: 'b.md', contentHash: 'hb' });
      await target.upsertEntry({ filePath: 'gone.md', contentHash: 'hg' });

      // Act
      await target.syncFromManifest([makeFile('a.md', 'ha'), makeFile('b.md', 'hb')]);

      // Assert
      const all = await target.getAll();
      expect(all.map((r) => r.filePath).sort()).toEqual(['a.md', 'b.md']);
    });

    it('soft-fails on internal exception — does NOT rethrow', async () => {
      // Arrange — close the data source so the next query throws.
      const tempDs = await createPgMemDataSource([PgMemFileManifestSchema]);
      const tempRepo = tempDs.getRepository(PgMemFileManifestSchema);
      const tempModule = await Test.createTestingModule({
        providers: [
          FileManifestRepositoryImpl,
          {
            provide: getRepositoryToken(FileManifestSchema, DBConnections.INTERNAL),
            useValue: tempRepo,
          },
        ],
      })
        .setLogger(new MockLoggerService())
        .compile();
      const tempTarget = tempModule.get<FileManifestRepositoryImpl>(FileManifestRepositoryImpl);
      await tempDs.destroy();

      // Act / Assert — must NOT rethrow.
      await expect(tempTarget.syncFromManifest([makeFile('a.md', 'ha')])).resolves.toBeUndefined();
      await tempModule.close();
    });
  });
});
