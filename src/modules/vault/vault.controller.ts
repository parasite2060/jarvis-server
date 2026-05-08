/**
 * VaultController — Story 13.6.
 *
 * Two routes (per `architecture.md §4.1`):
 *   - GET /memory/files/manifest    — manifest + per-file hash + size + updatedAt
 *   - GET /memory/files/{filePath}  — raw markdown content + hash + size
 *
 * Wildcard `*path` (NestJS 11 / Express adapter — Q2 binding). The more-
 * specific `manifest` route is declared FIRST so the wildcard does not shadow
 * it.
 *
 * Wire format: camelCase per Q1 (plugin contract verified at
 * `worker/file-sync.js:44-45,116-119` + `hooks/lib/jarvis-client.js:88`).
 * `HttpApiResponse.success(...)` wrapping per Q7/Q8.
 */
import { Controller, Get, Param } from '@nestjs/common';
import { HttpApiResponse } from 'src/utils/api-http.response';
import { FileServePresenter } from './models/presenters/file-serve.presenter';
import { ManifestPresenter } from './models/presenters/manifest.presenter';
import { GetManifestUseCase } from './usecases/get-manifest.usecase';
import { GetVaultFileByPathUseCase } from './usecases/get-vault-file-by-path.usecase';

@Controller()
export class VaultController {
  constructor(
    private readonly getManifestUseCase: GetManifestUseCase,
    private readonly getVaultFileByPathUseCase: GetVaultFileByPathUseCase,
  ) {}

  @Get('memory/files/manifest')
  async getManifest(): Promise<HttpApiResponse<ManifestPresenter>> {
    const presenter = await this.getManifestUseCase.execute();
    return HttpApiResponse.success(presenter);
  }

  // NestJS 11 / Express wildcard catch-all — captures the rest of the URL
  // after `/memory/files/` (including `/`). The `manifest` route above is
  // more specific and takes precedence due to declaration order.
  @Get('memory/files/*path')
  async getFile(@Param('path') filePath: string | string[]): Promise<HttpApiResponse<FileServePresenter>> {
    // NestJS may pass the wildcard match as a string or string[] depending on
    // adapter version; normalise to a POSIX path either way.
    const normalised = Array.isArray(filePath) ? filePath.join('/') : filePath;
    const presenter = await this.getVaultFileByPathUseCase.execute(normalised);
    return HttpApiResponse.success(presenter);
  }
}
