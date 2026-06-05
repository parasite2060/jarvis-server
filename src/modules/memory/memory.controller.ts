/**
 * MemoryController — GET /memory/soul, GET /memory/identity, GET /memory/memory.
 *
 * These three routes read vault markdown files. The MemU-backed
 * `POST /memory/search` and `POST /memory/add` routes have been removed.
 *
 * The boilerplate flat envelope `{ code, message, data }` wraps each response.
 */
import { Controller, Get } from '@nestjs/common';
import { HttpApiResponse } from 'src/utils/api-http.response';
import { FileContentPresenter } from './models/presenters/file-content.presenter';
import { GetIdentityUseCase } from './usecases/get-identity.usecase';
import { GetMemoryFileUseCase } from './usecases/get-memory-file.usecase';
import { GetSoulUseCase } from './usecases/get-soul.usecase';

@Controller()
export class MemoryController {
  constructor(
    private readonly getSoulUseCase: GetSoulUseCase,
    private readonly getIdentityUseCase: GetIdentityUseCase,
    private readonly getMemoryFileUseCase: GetMemoryFileUseCase,
  ) {}

  @Get('memory/soul')
  async getSoul(): Promise<HttpApiResponse<FileContentPresenter>> {
    const presenter = await this.getSoulUseCase.execute();
    return HttpApiResponse.success(presenter);
  }

  @Get('memory/identity')
  async getIdentity(): Promise<HttpApiResponse<FileContentPresenter>> {
    const presenter = await this.getIdentityUseCase.execute();
    return HttpApiResponse.success(presenter);
  }

  @Get('memory/memory')
  async getMemory(): Promise<HttpApiResponse<FileContentPresenter>> {
    const presenter = await this.getMemoryFileUseCase.execute();
    return HttpApiResponse.success(presenter);
  }
}
