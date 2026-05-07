import { RedisModuleOptions } from '@nestjs-redis/kit';
import { AppConfigService } from 'src/shared/config/config.service';

export function defaultRedisConfig(configs: AppConfigService): RedisModuleOptions {
  return {
    type: 'client',
    options: {
      url: `redis://${configs.redisHost}:${configs.redisPort}`,
      password: configs.redisPass || undefined,
      database: configs.redisDb,
    },
  };
}
