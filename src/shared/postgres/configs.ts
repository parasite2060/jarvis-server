import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { AppConfigService } from 'src/shared/config/config.service';
import { configValidationSchema } from 'src/shared/config/config.schema';
import { DataSource, DataSourceOptions } from 'typeorm';
import DatabaseLogger from './utils/database.logger';
import { DBConnections } from 'src/shared/postgres/utils/constaint';

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
  };
}

// For cli migration — validate env via the same joi schema the app uses,
// then build AppConfigService manually (no DI container available here).
const { value: validatedEnv, error: configError } = configValidationSchema.validate(process.env, {
  allowUnknown: true,
  stripUnknown: false,
});
if (configError) {
  throw new Error(`Config validation error: ${configError.message}`);
}
const cliConfig = new AppConfigService(new ConfigService(validatedEnv));

export const AppDataSource = new DataSource({
  ...optionsFactory(cliConfig),
  migrationsRun: false,
  entities: [__dirname + '/schema/*.schema.ts'],
} as DataSourceOptions);
