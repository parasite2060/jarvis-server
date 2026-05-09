/**
 * DreamController — POST /dream.
 *
 * Module-map §1 line 103 prescribes this controller. Story 13.14 fills the
 * functional body — deep-only manual trigger with optional `sourceDate` body.
 * Mirrors Python `dream.py:22-55` byte-for-byte per Standing Epic-13 Rule.
 *
 * Q3 SM pick: deep-only manual trigger (Python parity). Light + weekly are
 * auto-only; their use cases are injected but NOT invoked from this endpoint.
 * Q2 SM pick: UTC today-date computation.
 * Q7 SM pick: server accepts both camelCase (TS wire) and snake_case (plugin
 * wire) via dual `@Expose` decorators — no plugin code change needed.
 */
import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { TriggerDreamRequest } from './models/requests/trigger-dream.request';
import { TriggerDreamPresenter } from './models/presenters/trigger-dream.presenter';
import { TriggerDeepDreamUseCase } from './usecases/trigger-deep-dream.usecase';
import { HttpApiResponse } from 'src/utils/api-http.response';

@Controller()
export class DreamController {
  private readonly logger = new Logger(DreamController.name);

  constructor(private readonly triggerDeep: TriggerDeepDreamUseCase) {}

  @Post('dream')
  @HttpCode(202)
  async trigger(@Body() request: TriggerDreamRequest): Promise<HttpApiResponse<TriggerDreamPresenter>> {
    // Q2 SM pick: UTC today via .toISOString(). Python date.today() is UTC in prod.
    const todayUtc = new Date().toISOString().slice(0, 10);
    // Normalise: accept camelCase sourceDate OR snake_case source_date (Q7 SM pick).
    const rawSource = request.sourceDate ?? request.source_date ?? null;
    const targetDate = rawSource ?? todayUtc;
    const trigger = rawSource ? 'manual-backfill' : 'manual';
    const sourceDateIso = rawSource;

    await this.triggerDeep.execute({ targetDate, trigger, sourceDateIso });

    this.logger.log({
      event: 'dream.manualTrigger.queued',
      trigger,
      ...(sourceDateIso && { sourceDate: sourceDateIso }),
    });

    return HttpApiResponse.success(new TriggerDreamPresenter('queued'));
  }
}
