import { EntitySchema } from 'typeorm';
import { FileManifestEntry } from 'src/shared/domain/entities/file-manifest-entry.entity';

/**
 * `jarvis.file_manifest` schema (Story 13.2 / Task 4).
 *
 * Mirrors `FileManifest` in `components/jarvis-server/app/models/tables.py`.
 * `file_path` carries both a UNIQUE constraint and a unique index — Alembic
 * 0001 emits both (`uq_file_manifest_file_path` + `ix_file_manifest_file_path`).
 */
export const FileManifestSchema = new EntitySchema<FileManifestEntry>({
  name: 'FileManifestEntry',
  schema: 'jarvis',
  tableName: 'file_manifest',
  columns: {
    id: {
      type: 'integer',
      primary: true,
      generated: 'increment',
    },
    filePath: {
      name: 'file_path',
      type: 'varchar',
      length: 500,
      nullable: false,
    },
    contentHash: {
      name: 'content_hash',
      type: 'varchar',
      length: 64,
      nullable: false,
    },
    fileSize: {
      name: 'file_size',
      type: 'integer',
      nullable: true,
    },
    updatedAt: {
      name: 'updated_at',
      type: 'timestamp with time zone',
      createDate: true,
      updateDate: true,
    },
  },
  uniques: [{ name: 'uq_file_manifest_file_path', columns: ['filePath'] }],
  indices: [{ name: 'ix_file_manifest_file_path', columns: ['filePath'], unique: true }],
});
