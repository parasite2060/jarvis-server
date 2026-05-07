import { Controller, Get, Inject } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  HealthIndicator,
  HealthIndicatorResult,
  MongooseHealthIndicator,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SilentRequestLog } from '../logger/decorators/silent-request-log.decorators';
import { SilentResponseLog } from '../logger/decorators/silent-response-log.decorators';
import { InjectRedis, RedisHealthIndicator } from '@nestjs-redis/kit';
import { RedisClientType } from 'redis';
import { DBConnections } from '../postgres/utils/constaint';
import { TemporalHealthIndicator } from './indicators/temporal.indicator';
import { MemuHealthIndicator } from './indicators/memu.indicator';

// Story 13.1 (AC #6): /health is exempt from auth. When Story 13.4 / 13.16.6
// introduce ApiKeyGuard, this controller MUST stay unauthenticated so probes
// from Docker / Compose / external monitoring keep working.
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly redis: RedisHealthIndicator,
    private readonly db: TypeOrmHealthIndicator,
    private readonly mongoose: MongooseHealthIndicator,
    @InjectRedis() private readonly redisClient: RedisClientType,
    private readonly temporal: TemporalHealthIndicator,
    private readonly memu: MemuHealthIndicator,
    // Boilerplate registers a NAMED DataSource (DBConnections.INTERNAL) and no default
    // one. TypeOrmHealthIndicator.pingCheck() looks up the default via DI unless an
    // explicit { connection } is passed — see Round 1 fix on Story 13.1.
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
      // TODO [Story 13.16.5]: remove Mongo + Redis indicators when modules are deleted
      () => this.redis.isHealthy('redis', { client: this.redisClient }),
      () => this.db.pingCheck('postgres', { connection: this.dataSource }),
      // TODO [Story 13.16.5]: remove Mongo + Redis indicators when modules are deleted
      () => this.mongoose.pingCheck('mongodb'),
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
