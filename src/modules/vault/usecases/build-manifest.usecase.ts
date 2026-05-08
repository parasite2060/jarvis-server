/**
 * BuildManifestUseCase — Story 13.6 / Task 8.
 *
 * Composes scan-then-hash. Mirrors Python `app/services/file_manifest.py ::
 * build_manifest()` byte-equivalently:
 *   - `manifestHash = SHA-256(sorted("path:hash" for f in files).join("\n"))`.
 *   - Sort happens ONLY for the hash computation; the returned `files` array
 *     preserves the scan walk order (mirrors Python `scan_vault_files()` +
 *     `compute_manifest_hash()` separation).
 *   - `generatedAt` is `new Date()` at build time (Python `datetime.now(tz=UTC)`).
 *
 * Hash determinism: same vault state produces the same hash regardless of walk
 * order. Verified by spec.
 */
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ScanVaultUseCase, VaultFileInfo } from './scan-vault.usecase';

export interface ManifestBuildResult {
  files: VaultFileInfo[];
  manifestHash: string;
  generatedAt: Date;
}

@Injectable()
export class BuildManifestUseCase {
  private readonly logger = new Logger(BuildManifestUseCase.name);

  constructor(private readonly scanVaultUseCase: ScanVaultUseCase) {}

  async execute(): Promise<ManifestBuildResult> {
    const files = await this.scanVaultUseCase.execute();
    const entries = files.map((f) => `${f.relativePath}:${f.contentHash}`).sort();
    const combined = entries.join('\n');
    const manifestHash = createHash('sha256').update(combined, 'utf8').digest('hex');
    this.logger.log({
      message: 'vault manifest built',
      event: 'vault.manifest.built',
      fileCount: files.length,
      manifestHash,
    });
    return { files, manifestHash, generatedAt: new Date() };
  }
}
