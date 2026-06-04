import { Module, forwardRef } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { RedisHealthIndicator } from '@nestjs-redis/kit';
import { TemporalHealthIndicator } from './indicators/temporal.indicator';
import { VaultModule } from '../../modules/vault/vault.module';

@Module({
  // VaultModule is imported with forwardRef because VaultSyncService (in VaultModule)
  // and VaultSyncHealthIndicator (in VaultModule) have a circular relationship at
  // the NestJS module level. VaultSyncHealthIndicator is declared as a provider
  // in VaultModule so the injection works without a direct dep cycle.
  imports: [TerminusModule, forwardRef(() => VaultModule)],
  controllers: [HealthController],
  providers: [RedisHealthIndicator, TemporalHealthIndicator],
})
export class HealthModule {}
