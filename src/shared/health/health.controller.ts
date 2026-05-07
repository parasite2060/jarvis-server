import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  HealthIndicator,
  HealthIndicatorResult,
  MongooseHealthIndicator,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { SilentRequestLog } from '../logger/decorators/silent-request-log.decorators';
import { SilentResponseLog } from '../logger/decorators/silent-response-log.decorators';
import { InjectRedis, RedisHealthIndicator } from '@nestjs-redis/kit';
import { RedisClientType } from 'redis';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly redis: RedisHealthIndicator,
    private readonly db: TypeOrmHealthIndicator,
    private readonly mongoose: MongooseHealthIndicator,
    @InjectRedis() private readonly redisClient: RedisClientType,
  ) {}

  @Get()
  @HealthCheck()
  @SilentRequestLog()
  @SilentResponseLog()
  public async check(): Promise<HealthCheckResult> {
    return await this.health.check([
      () => new SimpleHealthIndicator().check('application'),
      () => this.redis.isHealthy('redis', { client: this.redisClient }),
      () => this.db.pingCheck('postgres'),
      () => this.mongoose.pingCheck('mongodb'),
    ]);
  }
}

class SimpleHealthIndicator extends HealthIndicator {
  public check(key: string): HealthIndicatorResult {
    return super.getStatus(key, true, { message: 'Up and running' });
  }
}
