/**
 * CronChangedEventsHandler — Story 13.13.
 *
 * Consumes `CronChangedEvent` (published by `UpdateConfigUseCase` after
 * `PATCH /config` writes a new cron value) and re-registers the affected
 * Temporal Schedule via `TemporalClientService.updateSchedule(...)`.
 *
 * # Cross-module event consumption
 * The event class is imported FROM `src/modules/config/events/cron-changed.event.ts`.
 * Per Q12 RESOLVED 2026-05-09 + architecture.md §1.4 + module-map §5.2.7:
 * importing an event CLASS for `@EventsHandler(...)` is allowed (events
 * are TS classes; resolution via global `CqrsModule.EventBus`). NO
 * `imports: [JarvisConfigModule]` in `dream.module.ts`.
 *
 * # Q13 fire-and-forget
 * Errors are logged but NOT re-thrown. The next app boot's
 * `registerSchedules()` self-heals if Temporal was unreachable when the
 * event fired.
 */
import { Injectable, Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { CronChangedEvent } from 'src/modules/config/events/cron-changed.event';
import { ScheduleId, TemporalClientService } from 'src/shared/temporal/temporal-client.service';

@Injectable()
@EventsHandler(CronChangedEvent)
export class CronChangedEventsHandler implements IEventHandler<CronChangedEvent> {
  private readonly logger = new Logger(CronChangedEventsHandler.name);

  constructor(private readonly temporalClient: TemporalClientService) {}

  async handle(event: CronChangedEvent): Promise<void> {
    const { kind, newCron } = event.payload;
    const scheduleId: ScheduleId = kind === 'deepDream' ? 'deep-dream-nightly' : 'weekly-review';

    try {
      await this.temporalClient.updateSchedule(scheduleId, newCron);
      this.logger.log({
        message: 'cron change → schedule updated',
        event: 'dream.cronChanged.scheduleUpdated',
        kind,
        scheduleId,
        newCron,
      });
    } catch (err) {
      this.logger.error({
        message: 'cron change → schedule update failed (will self-heal on next boot)',
        event: 'dream.cronChanged.scheduleUpdateFailed',
        kind,
        scheduleId,
        errorClass: (err as { name?: string })?.name ?? 'Error',
      });
      // Q13 fire-and-forget: do NOT re-throw.
    }
  }
}
