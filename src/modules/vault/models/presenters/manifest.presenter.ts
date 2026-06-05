/**
 * Manifest envelope presenter — Story 13.6 / Q1 binding.
 *
 * Plugin reads `data.manifestHash`, `data.files`, etc. (verified at
 * `worker/file-sync.js:44-45`). camelCase wire format throughout.
 */
import { ManifestFileEntry } from './manifest-file-entry';

export class ManifestPresenter {
  public readonly files: ManifestFileEntry[];
  public readonly manifestHash: string;
  public readonly fileCount: number;
  public readonly generatedAt: string;

  constructor(init: { files: ManifestFileEntry[]; manifestHash: string; fileCount: number; generatedAt: string }) {
    this.files = init.files;
    this.manifestHash = init.manifestHash;
    this.fileCount = init.fileCount;
    this.generatedAt = init.generatedAt;
  }
}
