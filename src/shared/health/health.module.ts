import { HttpModule } from '@nestjs/axios';
import { Module, forwardRef } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { RedisHealthIndicator } from '@nestjs-redis/kit';
import { TemporalHealthIndicator } from './indicators/temporal.indicator';
import { MemuHealthIndicator } from './indicators/memu.indicator';
import { VaultModule } from '../../modules/vault/vault.module';

@Module({
  // HttpModule is needed by `MemuHealthIndicator` for the HEAD probe. ApiModule
  // imports it globally for its own providers, but does NOT re-export it, so we
  // import locally here.
  //
  // VaultModule is imported with forwardRef because VaultSyncService (in VaultModule)
  // and VaultSyncHealthIndicator (in VaultModule) have a circular relationship at
  // the NestJS module level. VaultSyncHealthIndicator is declared as a provider
  // in VaultModule so the injection works without a direct dep cycle.
  imports: [TerminusModule, HttpModule, forwardRef(() => VaultModule)],
  controllers: [HealthController],
  providers: [RedisHealthIndicator, TemporalHealthIndicator, MemuHealthIndicator],
})
export class HealthModule {}
