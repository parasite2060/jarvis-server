/**
 * Thrown by `GetVaultFileUseCase` (and Story 13.6's vault user-supplied-path
 * controller) when a relative path resolves outside the vault root. Mapped to
 * HTTP 403 (security; not 404) by `VaultPathTraversalExceptionFilter`.
 */
import { BaseException } from 'src/shared/common/models/exception/base.exception';
import { ErrorCode } from 'src/utils/error.code';

export class VaultPathTraversalError extends BaseException {
  constructor() {
    super(ErrorCode.VAULT_PATH_TRAVERSAL, 'Path traversal blocked');
    this.name = 'VaultPathTraversalError';
  }
}
