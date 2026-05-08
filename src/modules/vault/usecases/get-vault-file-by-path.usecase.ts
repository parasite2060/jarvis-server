/**
 * GetVaultFileByPathUseCase — Story 13.6 / Q4 + Q7.
 *
 * Mirrors Python `app/api/routes/files.py :: get_file()` (lines 86-127):
 *   - `safeResolveVaultPath` returns null on traversal → throw
 *     `VaultEndpointPathTraversalError` → HTTP 400 (Python `files.py:91-101`).
 *   - `fs.readFile` throws ENOENT/EISDIR → throw `VaultEndpointFileNotFoundError`
 *     → HTTP 404 (Python `files.py:103-113`).
 *   - Otherwise: SHA-256 hex hash of bytes + UTF-8 decode for `content` +
 *     `size` from byte length. Returns `FileServePresenter`.
 *
 * Module-internal use case (NOT exposed via CommandBus per Q4).
 */
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { AppConfigService } from 'src/shared/config/config.service';
import { VaultEndpointFileNotFoundError } from 'src/shared/common/exceptions/vault-endpoint-file-not-found.error';
import { VaultEndpointPathTraversalError } from 'src/shared/common/exceptions/vault-endpoint-path-traversal.error';
import { FileServePresenter } from '../models/presenters/file-serve.presenter';
import { safeResolveVaultPath } from '../utils/path-validation';

@Injectable()
export class GetVaultFileByPathUseCase {
  private readonly logger = new Logger(GetVaultFileByPathUseCase.name);

  constructor(private readonly appConfig: AppConfigService) {}

  async execute(filePath: string): Promise<FileServePresenter> {
    const resolved = safeResolveVaultPath(this.appConfig.vaultPath, filePath);
    if (resolved === null) {
      this.logger.warn({
        message: 'vault file-by-path traversal blocked',
        event: 'vault.pathTraversal.blocked',
        path: filePath,
      });
      throw new VaultEndpointPathTraversalError();
    }
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(resolved);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EISDIR') {
        this.logger.log({
          message: 'vault file-by-path not found',
          event: 'vault.fileServe.notFound',
          path: filePath,
        });
        throw new VaultEndpointFileNotFoundError(filePath);
      }
      throw err;
    }
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    this.logger.log({
      message: 'vault file-by-path completed',
      event: 'vault.fileServe.completed',
      path: filePath,
      size: bytes.byteLength,
    });
    return new FileServePresenter({
      content: bytes.toString('utf-8'),
      filePath,
      hash: contentHash,
      size: bytes.byteLength,
    });
  }
}
