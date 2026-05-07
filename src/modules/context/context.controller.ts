/**
 * ContextController — Story 13.5 / GET /memory/context.
 *
 * Single route. Returns the boilerplate-flat `HttpApiResponse.success(...)`
 * envelope wrapping the `ContextPresenter` (snake_case fields per N1). The
 * plugin's `getContext()` reads `envelope.data.context` only — `cached` and
 * `assembled_at` are wire-stable but plugin-tolerant.
 */
import { Controller, Get } from '@nestjs/common';
import { HttpApiResponse } from 'src/utils/api-http.response';
import { ContextPresenter } from './models/presenters/context.presenter';
import { GetContextUseCase } from './usecases/get-context.usecase';

@Controller()
export class ContextController {
  constructor(private readonly getContextUseCase: GetContextUseCase) {}

  @Get('memory/context')
  async getContext(): Promise<HttpApiResponse<ContextPresenter>> {
    const presenter = await this.getContextUseCase.execute();
    return HttpApiResponse.success(presenter);
  }
}
