/**
 * GetManifestUseCase — Story 13.6 / Q6 + Q8.
 *
 * HTTP-facing manifest endpoint use case. Mirrors Python `app/api/routes/files.py
 * :: get_manifest()`:
 *   1. Build manifest in-memory (scan + hash) via `BuildManifestUseCase`.
 *   2. Fire-and-forget DB sync via `void fileManifestRepo.syncFromManifest(files)`
 *      — diff algorithm + soft-fail logging live INSIDE the repo (Task 6).
 *   3. Map domain `VaultFileInfo[]` → wire `ManifestFileEntry[]` with
 *      `formatPythonIso(updatedAt)` for the camelCase Python-ISO timestamp.
 *   4. Return `ManifestPresenter` (camelCase per Q1).
 */
import { Inject, Injectable } from '@nestjs/common';
import { FILE_MANIFEST_REPOSITORY, IFileManifestRepository } from 'src/shared/domain/repositories/file-manifest.repository.interface';
import { formatPythonIso } from 'src/shared/utils/format-iso';
import { ManifestFileEntry } from '../models/presenters/manifest-file-entry';
import { ManifestPresenter } from '../models/presenters/manifest.presenter';
import { BuildManifestUseCase } from './build-manifest.usecase';

@Injectable()
export class GetManifestUseCase {
  constructor(
    private readonly buildManifestUseCase: BuildManifestUseCase,
    @Inject(FILE_MANIFEST_REPOSITORY)
    private readonly fileManifestRepo: IFileManifestRepository,
  ) {}

  async execute(): Promise<ManifestPresenter> {
    const result = await this.buildManifestUseCase.execute();
    // Fire-and-forget DB sync (Q6) — diff algorithm + soft-fail in the repo.
    void this.fileManifestRepo.syncFromManifest(result.files);
    const fileEntries = result.files.map((f) => new ManifestFileEntry(f.relativePath, f.contentHash, f.fileSize, formatPythonIso(f.updatedAt)));
    return new ManifestPresenter({
      files: fileEntries,
      manifestHash: result.manifestHash,
      fileCount: fileEntries.length,
      generatedAt: formatPythonIso(result.generatedAt),
    });
  }
}
