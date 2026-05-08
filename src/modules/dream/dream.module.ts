import { Module } from '@nestjs/common';
import { LightDreamActivities } from './temporal/activities/light';
import { DeepDreamActivities } from './temporal/activities/deep';

/**
 * DreamModule — owns dream pipelines (light/deep/weekly).
 *
 * Story 13.9 created the empty module + the dreamCoordinatorWorkflow source
 * file. Story 13.10 added LightDreamActivities. Story 13.11 adds
 * DeepDreamActivities (12 grouped methods).
 *
 * # Architecture rule §7.5 — empty `imports: []`
 *   `CqrsModule` (global per Story 13.5) and `AgentsModule` (global per
 *   Story 13.10) are accessible without re-import. The activity service
 *   constructors inject `CommandBus`, `DeepAgentFactory`, `PromptCacheService`
 *   directly via the global DI tree.
 *
 * # Q14 from 13.10 RESOLVED — empty imports validated.
 */
@Module({
  providers: [LightDreamActivities, DeepDreamActivities],
})
export class DreamModule {}
