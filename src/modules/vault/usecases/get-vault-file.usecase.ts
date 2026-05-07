/**
 * GetVaultFileUseCase (Story 13.4 / Q1 — VaultModule stub).
 *
 * Mirrors Python `app/services/memory_files.py :: read_vault_file(relative_path)`:
 *   - Resolves `<vaultPath>/<relativePath>`; rejects paths that escape the vault root.
 *   - Returns `null` content when the file is missing OR when path traversal is blocked
 *     (matches Python's `read_vault_file` returning `None` in both branches —
 *     `memory_files.py:46-52`). The caller (memory module's GetSoul/GetIdentity/
 *     GetMemoryFile use case) decides between 404 (not found) and 403 (path
 *     traversal) by inspecting which branch was logged; for the in-scope routes
 *     (`SOUL.md` / `IDENTITY.md` / `MEMORY.md`) the path is hardcoded so the
 *     traversal branch is unreachable from the controller.
 *
 * Story 13.6 retrofits this module with manifest + file-by-path endpoints + the
 * full path-traversal centralisation. This stub ships ONLY the read path.
 */
import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AppConfigService } from 'src/shared/config/config.service';
import { GetVaultFileResult } from '../commands/get-vault-file.command';

@Injectable()
export class GetVaultFileUseCase {
  private readonly logger = new Logger(GetVaultFileUseCase.name);

  constructor(private readonly appConfig: AppConfigService) {}

  async execute(relativePath: string): Promise<GetVaultFileResult> {
    const vaultRoot = path.resolve(this.appConfig.vaultPath);
    const candidate = path.resolve(vaultRoot, relativePath);
    if (!isWithin(vaultRoot, candidate)) {
      this.logger.warn({
        message: 'vault read blocked by path-traversal check',
        event: 'vault.readFile.pathTraversal',
        path: relativePath,
      });
      return { content: null, file_path: relativePath };
    }
    try {
      const content = await fs.readFile(candidate, 'utf-8');
      this.logger.log({
        message: 'vault read succeeded',
        event: 'vault.readFile.completed',
        path: relativePath,
        length: content.length,
      });
      return { content, file_path: relativePath };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EISDIR') {
        this.logger.log({
          message: 'vault file not found',
          event: 'vault.readFile.notFound',
          path: relativePath,
        });
        return { content: null, file_path: relativePath };
      }
      throw err;
    }
  }
}

function isWithin(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
