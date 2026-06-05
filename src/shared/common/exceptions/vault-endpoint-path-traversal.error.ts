/**
 * Thrown by `GetVaultFileByPathUseCase` (Story 13.6) when a user-supplied
 * vault path resolves outside the vault root. Distinct from Story 13.4's
 * `VaultPathTraversalError`:
 *   - Story 13.4's variant maps to HTTP 403 (the SOUL/IDENTITY/MEMORY paths
 *     are hardcoded; the throw is unreachable from the controller — it's a
 *     defence-in-depth fallback).
 *   - Story 13.6's variant maps to HTTP 400 per Python `files.py:91-101`
 *     ("Path traversal is not allowed" — the user supplied the path).
 */
import { BaseException } from 'src/shared/common/models/exception/base.exception';
import { ErrorCode } from 'src/utils/error.code';

export class VaultEndpointPathTraversalError extends BaseException {
  constructor() {
    super(ErrorCode.VAULT_ENDPOINT_PATH_TRAVERSAL, 'Path traversal is not allowed');
    this.name = 'VaultEndpointPathTraversalError';
  }
}
