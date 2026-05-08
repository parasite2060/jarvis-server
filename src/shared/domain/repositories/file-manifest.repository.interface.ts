import { FileManifestEntry } from '../entities/file-manifest-entry.entity';

export const FILE_MANIFEST_REPOSITORY = Symbol('FILE_MANIFEST_REPOSITORY');

/**
 * VaultFileInfo — domain shape consumed by `syncFromManifest`.
 *
 * Mirrors the use-case-internal type defined in
 * `src/modules/vault/usecases/scan-vault.usecase.ts`. Re-stated here as a
 * domain interface so the repository contract stays free of cross-module
 * imports (the use case may import this domain shape, NOT vice versa).
 */
export interface VaultFileInfo {
  relativePath: string;
  contentHash: string;
  fileSize: number;
  updatedAt: Date;
}

/**
 * Story 13.2 ships the interface only — no implementation. The concrete repo
 * lands in Story 13.6 (vault module — manifest + file serving). Story 13.6 also
 * extends the interface with `syncFromManifest` (Q6 binding) — a soft-fail diff
 * algorithm that mirrors Python `file_manifest.py :: sync_file_manifest_to_db()`.
 */
export interface IFileManifestRepository {
  upsertEntry(entry: Partial<FileManifestEntry>): Promise<FileManifestEntry>;
  getAll(): Promise<FileManifestEntry[]>;
  getByPath(path: string): Promise<FileManifestEntry | null>;
  deleteByPath(path: string): Promise<void>;
  // Story 13.6 / Q6 — fire-and-forget diff applied by the manifest endpoint.
  // Soft-fail inside the impl; never rethrows.
  syncFromManifest(files: VaultFileInfo[]): Promise<void>;
}
