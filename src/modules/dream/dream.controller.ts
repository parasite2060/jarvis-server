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
import { TriggerLightDreamUseCase } from './usecases/trigger-light-dream.usecase';
import { TriggerWeeklyReviewUseCase } from './usecases/trigger-weekly-review.usecase';
import { HttpApiResponse } from 'src/utils/api-http.response';

/** Return Monday (YYYY-MM-DD) of the week containing the given ISO date. */
function mondayOfWeek(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  const day = d.getUTCDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? -6 : 1 - day; // adjust to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

@Controller()
export class DreamController {
  private readonly logger = new Logger(DreamController.name);

  constructor(
    private readonly triggerDeep: TriggerDeepDreamUseCase,
    private readonly triggerLight: TriggerLightDreamUseCase,
    private readonly triggerWeekly: TriggerWeeklyReviewUseCase,
  ) {}

  @Post('dream')
  @HttpCode(202)
  async trigger(@Body() request: TriggerDreamRequest): Promise<HttpApiResponse<TriggerDreamPresenter>> {
    const todayUtc = new Date().toISOString().slice(0, 10);
    const rawSource = request.sourceDate ?? request.source_date ?? null;
    const targetDate = rawSource ?? todayUtc;
    const trigger = rawSource ? 'manual-backfill' : 'manual';
    const sourceDateIso = rawSource;

    const useLight = request.type === 'light';
    const useWeeklyReview = request.type === 'weekly-review';

    if (useLight) {
      this.logger.log({
        event: 'dream.manualTrigger.light',
        trigger,
        ...(sourceDateIso && { sourceDate: sourceDateIso }),
      });
      // Story 13.22 AC #1: create DB record before signaling
      const { dreamId } = await this.triggerLight.execute({
        sessionId: 'manual',
        transcriptId: null,
        targetDate,
        trigger,
        sourceDateIso,
      });
      return HttpApiResponse.success(new TriggerDreamPresenter('queued', dreamId, trigger, sourceDateIso ?? undefined, targetDate));
    }

    if (useWeeklyReview) {
      this.logger.log({
        event: 'dream.manualTrigger.weekly-review',
        trigger,
        ...(sourceDateIso && { sourceDate: sourceDateIso }),
      });
      // Story 13.22 AC #2: create DB record before signaling coordinator
      const weekStart = mondayOfWeek(targetDate);
      const { dreamId } = await this.triggerWeekly.execute({ weekStart, trigger });
      return HttpApiResponse.success(new TriggerDreamPresenter('queued', dreamId, trigger, sourceDateIso ?? undefined, targetDate));
    }

    // Deep dream — already returns { dreamId } from DB insert (Story 13.22 refactor)
    const { dreamId } = await this.triggerDeep.execute({ targetDate, trigger, sourceDateIso });

    this.logger.log({
      event: 'dream.manualTrigger.deep',
      trigger,
      ...(sourceDateIso && { sourceDate: sourceDateIso }),
    });

    return HttpApiResponse.success(new TriggerDreamPresenter('queued', dreamId, trigger, sourceDateIso ?? undefined, targetDate));
  }
}
