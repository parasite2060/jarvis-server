/* eslint-disable @typescript-eslint/no-explicit-any */
import { Global, Logger, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MongooseError } from 'mongoose';
import { MongoSchemas } from './schemas';
import { Repositories } from './repositories';
import { AppConfigService } from '../config/config.service';

const logger = new Logger('Mongoose');

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      useFactory: (configs: AppConfigService) => ({
        uri: configs.mongodbUri,
        retryAttempts: configs.mongodbRetryAttempts,
        retryDelay: configs.mongodbRetryDelay,
        connectTimeoutMS: configs.mongodbConnectTimeout,
        socketTimeoutMS: configs.mongodbTimeout,
        connectionFactory: (connection: any, name: string) => {
          logger.verbose(`Start connection to mongodb. Name: ${name}`);
          return connection;
        },
        connectionErrorFactory: (error: MongooseError) => {
          logger.error({
            message: `Try connect to mongodb error. Name: ${error.name}`,
            error: error,
          });
          return error;
        },
      }),
      inject: [AppConfigService],
    }),
    MongooseModule.forFeature(MongoSchemas),
  ],
  providers: [...Repositories],
  exports: [MongooseModule, ...Repositories],
})
export class MongoDBModule {}
