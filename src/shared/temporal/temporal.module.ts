/**
 * @Global TemporalModule (Story 13.3 introduced; Story 13.8 extended).
 *
 * Story 13.3 shipped the `TemporalClientService` stub for `IngestTranscriptUseCase`
 * to inject. Story 13.8 retrofits the client to a real `@temporalio/client`
 * wrapper AND adds `TemporalWorkerService` + `ActivityRegistry` for the
 * co-located worker bootstrap.
 *
 * `ActivityRegistry` is provider-only (NOT exported) — only
 * `TemporalWorkerService` consumes it.
 */
import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { ActivityRegistry } from './activity-registry.service';
import { TemporalClientService } from './temporal-client.service';
import { TemporalWorkerService } from './temporal-worker.service';

@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [TemporalClientService, TemporalWorkerService, ActivityRegistry],
  exports: [TemporalClientService, TemporalWorkerService],
})
export class TemporalModule {}
