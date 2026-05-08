import { Module } from '@nestjs/common';
import { Activities as LightActivities } from './temporal/activities/light';
import { Activities as DeepActivities } from './temporal/activities/deep';
import { Activities as WeeklyActivities } from './temporal/activities/weekly';
import { DreamController } from './dream.controller';
import { UseCases } from './usecases';
import { CommandHandlers } from './commands/handlers';

/**
 * DreamModule — owns dream pipelines (light/deep/weekly).
 *
 * Story 13.9 created the empty module + the dreamCoordinatorWorkflow source
 * file. Story 13.10 added LightDreamActivities. Story 13.11 added
 * DeepDreamActivities. Story 13.12 added WeeklyReviewActivities.
 *
 * Story 13.10.5 adds (per module-map §1 + Q1/Q2/Q3 RESOLVED):
 *   - `dream.controller.ts` (POST /dream — placeholder, Story 13.14 fills)
 *   - `usecases/{trigger-light-dream, trigger-deep-dream, trigger-weekly-review}.usecase.ts`
 *   - `commands/trigger-light-dream.command.ts` + `handlers/trigger-light-dream.handler.ts`
 *     (replaces the conversation→dream direct-injection path; Q2 wins over §A.4)
 *   - `events/dream-completed.event.ts` (structurally present; no consumers in MVP)
 *
 * # Architecture rule §7.5 — empty `imports: []`
 *   `CqrsModule` (global per Story 13.5) and `AgentsModule` (global per
 *   Story 13.10) are accessible without re-import. The activity service
 *   constructors inject `CommandBus`, `DeepAgentFactory`, `PromptCacheService`
 *   directly via the global DI tree.
 */
@Module({
  controllers: [DreamController],
  providers: [...UseCases, ...CommandHandlers, ...LightActivities, ...DeepActivities, ...WeeklyActivities],
})
export class DreamModule {}
