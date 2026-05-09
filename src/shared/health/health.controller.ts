import { Controller, Get, Inject } from '@nestjs/common';
import { HealthCheck, HealthCheckResult, HealthCheckService, HealthIndicator, HealthIndicatorResult, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SilentRequestLog } from '../logger/decorators/silent-request-log.decorators';
import { SilentResponseLog } from '../logger/decorators/silent-response-log.decorators';
import { InjectRedis, RedisHealthIndicator } from '@nestjs-redis/kit';
import { RedisClientType } from 'redis';
import { DBConnections } from '../postgres/utils/constaint';
import { TemporalHealthIndicator } from './indicators/temporal.indicator';
import { MemuHealthIndicator } from './indicators/memu.indicator';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly redis: RedisHealthIndicator,
    private readonly db: TypeOrmHealthIndicator,
    @InjectRedis() private readonly redisClient: RedisClientType,
    private readonly temporal: TemporalHealthIndicator,
    private readonly memu: MemuHealthIndicator,
    @Inject(getDataSourceToken(DBConnections.INTERNAL))
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  @HealthCheck()
  @SilentRequestLog()
  @SilentResponseLog()
  public async check(): Promise<HealthCheckResult> {
    return await this.health.check([
      () => new SimpleHealthIndicator().check('application'),
      () => this.redis.isHealthy('redis', { client: this.redisClient }),
      () => this.db.pingCheck('postgres', { connection: this.dataSource }),
      () => this.temporal.isHealthy('temporal'),
      () => this.memu.isHealthy('memu'),
    ]);
  }
}

class SimpleHealthIndicator extends HealthIndicator {
  public check(key: string): HealthIndicatorResult {
    return super.getStatus(key, true, { message: 'Up and running' });
  }
}
