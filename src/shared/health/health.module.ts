import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { RedisHealthIndicator } from '@nestjs-redis/kit';
import { TemporalHealthIndicator } from './indicators/temporal.indicator';
import { MemuHealthIndicator } from './indicators/memu.indicator';

@Module({
  // HttpModule is needed by `MemuHealthIndicator` for the HEAD probe. ApiModule
  // imports it globally for its own providers, but does NOT re-export it, so we
  // import locally here.
  imports: [TerminusModule, HttpModule],
  controllers: [HealthController],
  providers: [RedisHealthIndicator, TemporalHealthIndicator, MemuHealthIndicator],
})
export class HealthModule {}
