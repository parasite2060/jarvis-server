/**
 * DreamController — POST /dream (Story 13.10.5 scaffold).
 *
 * Module-map §1 line 103 prescribes this controller. Story 13.14 fills the
 * functional body — kind-based dispatch to one of the trigger use cases
 * (light / deep / weekly). Here we expose the route with a 501-equivalent
 * placeholder so module structure conforms to §1 and NestJS route-discovery
 * recognises the endpoint.
 */
import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { TriggerDreamRequest } from './models/requests/trigger-dream.request';
import { TriggerDreamResponse } from './models/responses/trigger-dream.response';
import { TriggerLightDreamUseCase } from './usecases/trigger-light-dream.usecase';
import { TriggerDeepDreamUseCase } from './usecases/trigger-deep-dream.usecase';
import { TriggerWeeklyReviewUseCase } from './usecases/trigger-weekly-review.usecase';

@Controller()
export class DreamController {
  private readonly logger = new Logger(DreamController.name);

  constructor(
    private readonly triggerLight: TriggerLightDreamUseCase,
    private readonly triggerDeep: TriggerDeepDreamUseCase,
    private readonly triggerWeekly: TriggerWeeklyReviewUseCase,
  ) {}

  @Post('dream')
  @HttpCode(202)
  async trigger(@Body() request: TriggerDreamRequest): Promise<TriggerDreamResponse> {
    this.logger.warn({
      message: 'dream.controller.placeholder',
      event: 'dream.controller.placeholder',
      kind: request.kind,
      story: '13.14',
    });
    // Placeholder — Story 13.14 fills the functional body. Use cases are
    // injected so DI graph is complete; they are NOT invoked from the
    // placeholder body to avoid surprising side effects in 13.10.5.
    void this.triggerLight;
    void this.triggerDeep;
    void this.triggerWeekly;
    return new TriggerDreamResponse(true, request.kind);
  }
}
