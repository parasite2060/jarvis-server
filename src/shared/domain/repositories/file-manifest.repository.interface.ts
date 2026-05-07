import { FileManifestEntry } from '../entities/file-manifest-entry.entity';

export const FILE_MANIFEST_REPOSITORY = Symbol('FILE_MANIFEST_REPOSITORY');

/**
 * Story 13.2 ships the interface only — no implementation. The concrete repo
 * lands in Story 13.6 (vault module — manifest + file serving).
 */
export interface IFileManifestRepository {
  upsertEntry(entry: Partial<FileManifestEntry>): Promise<FileManifestEntry>;
  getAll(): Promise<FileManifestEntry[]>;
  getByPath(path: string): Promise<FileManifestEntry | null>;
  deleteByPath(path: string): Promise<void>;
}
