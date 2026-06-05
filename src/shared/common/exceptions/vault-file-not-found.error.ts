/**
 * Thrown by `GetSoulUseCase` / `GetIdentityUseCase` / `GetMemoryFileUseCase`
 * (and Story 13.6's vault file-by-path controller) when a vault file does not
 * exist. Mapped to HTTP 404 by `VaultFileNotFoundExceptionFilter`.
 */
import { BaseException } from 'src/shared/common/models/exception/base.exception';
import { ErrorCode } from 'src/utils/error.code';

export class VaultFileNotFoundError extends BaseException {
  constructor(relativePath: string) {
    super(ErrorCode.VAULT_FILE_NOT_FOUND, `${relativePath} not found in vault`);
    this.name = 'VaultFileNotFoundError';
  }
}
