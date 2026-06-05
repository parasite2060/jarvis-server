/**
 * FileManifestEntry entity (Story 13.2 / Task 3).
 *
 * POTO mirror of `jarvis.file_manifest` (Python `FileManifest` in
 * `components/jarvis-server/app/models/tables.py`). Class is named
 * `FileManifestEntry` per module-map §3.1 to disambiguate the row from the
 * conceptual "file manifest" returned by `GET /memory/files/manifest`.
 */
export class FileManifestEntry {
  id!: number;
  filePath!: string;
  contentHash!: string;
  fileSize?: number | null;
  updatedAt!: Date;

  constructor(init?: Partial<FileManifestEntry>) {
    Object.assign(this, init);
  }
}
