/**
 * Thrown by `GetVaultFileByPathUseCase` (Story 13.6) when a vault-endpoint
 * file read returns ENOENT/EISDIR. Distinct from Story 13.4's
 * `VaultFileNotFoundError` because:
 *   - Story 13.4 throws from SOUL/IDENTITY/MEMORY use cases with the
 *     MEMORY-context code (-400087).
 *   - Story 13.6 throws from the GET /memory/files/*path endpoint with the
 *     VAULT-context code (-400101) per Q9.
 *
 * Both map to HTTP 404; distinct codes encode WHICH endpoint failed.
 */
import { BaseException } from 'src/shared/common/models/exception/base.exception';
import { ErrorCode } from 'src/utils/error.code';

export class VaultEndpointFileNotFoundError extends BaseException {
  constructor(filePath: string) {
    super(ErrorCode.VAULT_ENDPOINT_FILE_NOT_FOUND, `File not found: ${filePath}`);
    this.name = 'VaultEndpointFileNotFoundError';
  }
}
