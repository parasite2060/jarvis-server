import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { RedisHealthIndicator } from '@nestjs-redis/kit';
import { TemporalHealthIndicator } from './indicators/temporal.indicator';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [RedisHealthIndicator, TemporalHealthIndicator],
})
export class HealthModule {}
