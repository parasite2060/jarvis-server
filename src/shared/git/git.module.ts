/**
 * @Global GitModule (Story 13.7).
 *
 * Mirrors `TemporalModule` (Story 13.3) and `SecretRedactionModule` (Story 13.3)
 * structurally — exports `GitOpsService` for direct injection by any business
 * module / activity per architecture §8.9 (allowed-callees: shared services
 * may be injected directly into business modules).
 */
import { Global, Module } from '@nestjs/common';
import { GitOpsService } from './git-ops.service';
import { GitOpsBackendFactory } from './git-ops-backend.factory';
import { GitOpsBackendProviders } from './backends/index';

@Global()
@Module({
  providers: [GitOpsService, GitOpsBackendFactory, ...GitOpsBackendProviders],
  exports: [GitOpsService],
})
export class GitModule {}
