import { Logger } from '@nestjs/common';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { AppConfigService } from 'src/shared/config/config.service';
import { DataSource } from 'typeorm';
import DatabaseLogger from './utils/database.logger';
import { DBConnections } from 'src/shared/postgres/utils/constaint';
import { CacheType } from 'src/shared/postgres/cache/cache-type.enum';
import { MemoryCacheProvider } from 'src/shared/postgres/cache/memory-cache.provider';
import { MultiCacheProvider } from 'src/shared/postgres/cache/multi-cache.provider';
import { QueryResultCache } from 'typeorm/cache/QueryResultCache';
import { RedisQueryResultCache } from 'typeorm/cache/RedisQueryResultCache';

const internalLogger = new Logger('PG-INTERNAL');

// For application
export function optionsFactory(configs: AppConfigService): TypeOrmModuleOptions {
  return {
    name: DBConnections.INTERNAL,
    type: 'postgres',
    host: configs.databaseHost,
    port: configs.databasePort,
    username: configs.databaseUser,
    password: configs.databasePassword,
    database: configs.databaseName,
    schema: configs.databaseSchema,
    entities: [__dirname + '/schema/*.schema{.ts,.js}'],
    synchronize: configs.databaseSynchronize,
    autoLoadEntities: false,
    migrationsTableName: 'migrations',
    migrations: [__dirname + '/migration/*{.ts,.js}'],
    migrationsRun: true,
    verboseRetryLog: true,
    logger: new DatabaseLogger(),
    connectTimeoutMS: 10000,
    maxQueryExecutionTime: 20000,
    poolSize: configs.databasePoolSize,
    extra: {
      idleTimeoutMillis: 60000,
      log: function (msg: string, err?: Error) {
        if (err) {
          internalLogger.error(msg + '.Detail: ' + err.message, err.stack);
        } else {
          internalLogger.verbose(msg);
        }
      },
    },
    cache: {
      ignoreErrors: true,
      provider(connection: DataSource): QueryResultCache {
        return new MultiCacheProvider([
          {
            type: CacheType.REDIS,
            provider: new RedisQueryResultCache(connection, 'redis'),
          },
          {
            type: CacheType.INMEMORY,
            provider: new MemoryCacheProvider(),
          },
        ]);
      },
      options: {
        host: configs.redisHost,
        port: configs.redisPort,
        username: 'default',
        password: configs.redisPass,
        db: configs.redisDb,
      },
    },
  };
}

// Manual load config when run from the cli
if (!process.env['DATABASE_HOST'] && (!process.env['NODE_ENV'] || process.env['NODE_ENV'] === 'local' || process.env['NODE_ENV'] === 'test')) {
  // eslint-disable-next-line
  require('dotenv').config();
}

// For cli migration
export const AppDataSource = new DataSource({
  name: DBConnections.INTERNAL,
  type: 'postgres',
  host: process.env['DATABASE_HOST'],
  port: parseInt(process.env['DATABASE_PORT'] || '5432'),
  username: process.env['DATABASE_USER'],
  password: process.env['DATABASE_PASSWORD'],
  database: process.env['DATABASE_NAME'],
  schema: process.env['DATABASE_SCHEMA'],
  entities: [__dirname + '/schema/*.schema.ts'],
  synchronize: JSON.parse(process.env['DATABASE_SYNCHRONIZE'] || 'false'),
  logger: new DatabaseLogger(),
  migrationsRun: false,
  migrationsTableName: 'migrations',
  migrations: [__dirname + '/migration/*{.ts,.js}'],
});
