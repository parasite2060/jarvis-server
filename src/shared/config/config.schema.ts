import * as Joi from 'joi';
import { NodeEnvironment, RuntimeEnvironment } from './environment';

export const configValidationSchema = Joi.object({
  // Server
  NODE_ENV: Joi.string()
    .valid(...Object.values(NodeEnvironment))
    .default(NodeEnvironment.DEVELOPMENT),
  HOST: Joi.string().required(),
  PORT: Joi.number().default(3000),

  // CORS
  CORS_ORIGINS: Joi.string().optional(),

  // Logger
  LOG_LEVEL: Joi.string().valid('trace', 'debug', 'info', 'warn', 'error', 'fatal').optional(),
  LOG_OUTPUT: Joi.string().valid('json', 'text').optional(),
  LOG_FILE_PATH: Joi.string().optional(),
  LOG_FILE: Joi.string().optional(),
  LOG_SYNC_FILE: Joi.string().optional(),

  // GRPC
  GRPC_URL: Joi.string().optional(),
  GRPC_PORT: Joi.number().optional(),
  MAX_SEND_SIZE_IN_MB: Joi.number().optional(),
  MAX_RECEIVE_SIZE_IN_MB: Joi.number().optional(),

  // Environment
  RUNTIME_ENV: Joi.string()
    .valid(...Object.values(RuntimeEnvironment))
    .required(),

  // Redis
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASS: Joi.string().allow('').optional(),
  REDIS_DB: Joi.number().default(0),

  // MongoDB
  MONGODB_URI: Joi.string().required(),
  MONGODB_RETRY_ATTEMPTS: Joi.number().required(),
  MONGODB_RETRY_DELAY: Joi.number().required(),
  MONGODB_CONNECT_TIMEOUT: Joi.number().required(),
  MONGODB_TIMEOUT: Joi.number().required(),

  // Postgres
  DATABASE_HOST: Joi.string().required(),
  DATABASE_PORT: Joi.number().required(),
  DATABASE_USER: Joi.string().required(),
  DATABASE_PASSWORD: Joi.string().required(),
  DATABASE_NAME: Joi.string().required(),
  DATABASE_SCHEMA: Joi.string().required(),
  DATABASE_SYNCHRONIZE: Joi.boolean().default(false),
  DATABASE_POOL_SIZE: Joi.number().default(10),
  DB_POOL_STATS: Joi.boolean().default(false),

  // Kafka
  KAFKA_DEFAULT_BROKER_URL: Joi.string().required(),
  KAFKA_DEFAULT_CLIENT_ID: Joi.string().required(),
  KAFKA_DEFAULT_GROUP_ID: Joi.string().required(),
  KAFKA_DEFAULT_AUTO_CREATE_TOPIC: Joi.boolean().default(false),
  KAFKA_DEFAULT_SSL: Joi.boolean().default(false),
  KAFKA_DEFAULT_MECHANISM: Joi.string().optional(),
  KAFKA_DEFAULT_USERNAME: Joi.string().optional(),
  KAFKA_DEFAULT_PASSWORD: Joi.string().optional(),
  KAFKA_DEFAULT_REQUEST_TIMEOUT: Joi.number().optional(),
  KAFKA_DEFAULT_CONCURRENTLY: Joi.number().optional(),
});
