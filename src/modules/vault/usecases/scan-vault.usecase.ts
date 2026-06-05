/**
 * ScanVaultUseCase — Story 13.6 / Task 7.
 *
 * Walks `appConfig.vaultPath` recursively and returns metadata + SHA-256 hash
 * for every included file. Mirrors Python `app/services/file_manifest.py ::
 * _scan_and_hash()` byte-equivalently:
 *   - Skip directories whose names start with `.` (e.g. `.git`, `.cache`).
 *   - Skip directories in `SKIP_DIRS = {.git, .backups, node_modules, __pycache__}`.
 *   - Skip files whose names start with `.` (e.g. `.gitignore`, `.DS_Store`).
 *   - Include files whose suffix (lowercase) is in `VAULT_EXTENSIONS = {.md, .yml, .yaml}`.
 *   - For each included file: SHA-256 of byte content, byte length, mtime as Date.
 *   - `relativePath` always POSIX (forward slashes — even on Windows).
 *
 * NO sorting in scan — sort happens for `manifestHash` computation only
 * (mirrors Python's `_scan_and_hash` + `compute_manifest_hash` separation).
 */
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AppConfigService } from 'src/shared/config/config.service';
import { VaultFileInfo } from 'src/shared/domain/repositories/file-manifest.repository.interface';

export type { VaultFileInfo } from 'src/shared/domain/repositories/file-manifest.repository.interface';

const SKIP_DIRS = new Set(['.git', '.backups', 'node_modules', '__pycache__']);
const VAULT_EXTENSIONS = new Set(['.md', '.yml', '.yaml']);

@Injectable()
export class ScanVaultUseCase {
  private readonly logger = new Logger(ScanVaultUseCase.name);

  constructor(private readonly appConfig: AppConfigService) {}

  async execute(): Promise<VaultFileInfo[]> {
    const root = path.resolve(this.appConfig.vaultPath);
    const results = await walk(root, root);
    this.logger.log({
      message: 'vault scan completed',
      event: 'vault.scan.completed',
      fileCount: results.length,
    });
    return results;
  }
}

async function walk(currentDir: string, root: string): Promise<VaultFileInfo[]> {
  const out: VaultFileInfo[] = [];
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const child = await walk(path.join(currentDir, entry.name), root);
      out.push(...child);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.startsWith('.')) continue;
    const suffix = path.extname(entry.name).toLowerCase();
    if (!VAULT_EXTENSIONS.has(suffix)) continue;
    const absolute = path.join(currentDir, entry.name);
    const bytes = await fs.readFile(absolute);
    const stat = await fs.stat(absolute);
    const relativePosix = path.relative(root, absolute).split(path.sep).join('/');
    out.push({
      relativePath: relativePosix,
      contentHash: createHash('sha256').update(bytes).digest('hex'),
      fileSize: bytes.byteLength,
      updatedAt: stat.mtime,
    });
  }
  return out;
}
