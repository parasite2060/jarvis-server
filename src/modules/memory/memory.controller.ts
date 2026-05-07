/**
 * MemoryController — POST /memory/search, POST /memory/add, GET /memory/soul,
 * GET /memory/identity, GET /memory/memory (Story 13.4 / Amendment 2 — five routes).
 *
 * `POST /memory/add` is SYNCHRONOUS HTTP 200 (Q5/Amendment 1) — NOT 202; NO Temporal
 * scheduling. Matches Python `memory.py:196-222` byte-equivalently.
 *
 * The boilerplate flat envelope `{ code, message, data }` wraps each response.
 * Plugin contract (MC1) is satisfied via `envelope.data.<field>` reads on the
 * plugin side — see story file Dev Notes §N1 for plugin parse-contract details.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { HttpApiResponse } from 'src/utils/api-http.response';
import { AddMemoryRequest } from './models/requests/add-memory.request';
import { SearchMemoryRequest } from './models/requests/search-memory.request';
import { AddMemoryResponse } from './models/responses/add-memory.response';
import { SearchMemoryResponse } from './models/responses/search-memory.response';
import { FileContentPresenter } from './models/presenters/file-content.presenter';
import { AddMemoryUseCase } from './usecases/add-memory.usecase';
import { GetIdentityUseCase } from './usecases/get-identity.usecase';
import { GetMemoryFileUseCase } from './usecases/get-memory-file.usecase';
import { GetSoulUseCase } from './usecases/get-soul.usecase';
import { SearchMemoryUseCase } from './usecases/search-memory.usecase';

@Controller()
export class MemoryController {
  constructor(
    private readonly searchMemoryUseCase: SearchMemoryUseCase,
    private readonly addMemoryUseCase: AddMemoryUseCase,
    private readonly getSoulUseCase: GetSoulUseCase,
    private readonly getIdentityUseCase: GetIdentityUseCase,
    private readonly getMemoryFileUseCase: GetMemoryFileUseCase,
  ) {}

  @Post('memory/search')
  @HttpCode(HttpStatus.OK)
  async search(@Body() request: SearchMemoryRequest): Promise<HttpApiResponse<SearchMemoryResponse>> {
    const response = await this.searchMemoryUseCase.execute(request);
    return HttpApiResponse.success(response);
  }

  // Q5/Amendment 1: synchronous HTTP 200 (NOT 202; NOT a Temporal-scheduled endpoint).
  @Post('memory/add')
  @HttpCode(HttpStatus.OK)
  async add(@Body() request: AddMemoryRequest): Promise<HttpApiResponse<AddMemoryResponse>> {
    const response = await this.addMemoryUseCase.execute(request);
    return HttpApiResponse.success(response);
  }

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
