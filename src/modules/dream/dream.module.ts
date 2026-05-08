import { Module } from '@nestjs/common';
import { LightDreamActivities } from './temporal/activities/light';

/**
 * DreamModule — owns dream pipelines (light/deep/weekly).
 *
 * Story 13.9 created the empty module + the dreamCoordinatorWorkflow source
 * file. Story 13.10 fills in the LightDreamActivities provider.
 *
 * # Architecture rule §7.5 — empty `imports: []`
 *   `CqrsModule` (global per Story 13.5) and `AgentsModule` (global per
 *   Story 13.10) are accessible without re-import. The activity service
 *   constructor injects `CommandBus`, `DeepAgentFactory`, `PromptCacheService`
 *   directly via the global DI tree.
 *
 * # Q14 RESOLVED 2026-05-08 — empty imports validated.
 */
@Module({
  providers: [LightDreamActivities],
})
export class DreamModule {}
