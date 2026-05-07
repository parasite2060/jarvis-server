import 'dotenv/config';
import { INestApplication, Logger, LoggerService, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost, NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  UnknownExceptionsFilter,
  DefaultInternalExceptionFilter,
  DefaultValidateExceptionFilter,
  DefaultUnauthorizedExceptionFilter,
  HttpExceptionFilter,
} from './utils/filter/exception.filter';
import { CustomLoggerService } from './shared/logger/services/custom-logger.service';
import { ClsService } from 'nestjs-cls';
import { HttpRequestLoggingInterceptor } from './shared/logger/interceptors/http-request-logging.interceptor';
import { KafkaRequestLoggingInterceptor } from './shared/logger/interceptors/kafka-request-logging.interceptor';
import { NestExpressApplication } from '@nestjs/platform-express';
import { getKafkaConfigs } from './utils/config/kafka.config';
import { DefaultValidationOptions } from './utils/config/validation.config';
import { GrpcRequestLoggingInterceptor } from './shared/logger/interceptors/grpc-request-logging.interceptor';
import { AppConfigService } from './shared/config/config.service';
import { getGRPCConfigs } from 'src/utils/config/grpc.config';
const logger = new Logger('Bootstrap');

async function bootstrap() {
  const isProduction = process.env['NODE_ENV'] === 'production';

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: isProduction
      ? false
      : {
          origin: process.env['CORS_ORIGINS'] ?? '*',
          methods: 'GET,HEAD,PUT,POST,DELETE',
        },
  });

  app.disable('x-powered-by');

  try {
    logAppEnv(logger);
    configure(app);

    await startHttp(app);
    await startGrpc(app);
    await startEvent(app);

    logAppPath(app, logger);
  } catch (error) {
    const stack = error instanceof Error ? error.stack : '';
    logger.error(`Error starting server, ${error}`, stack, 'Bootstrap');
    process.exit(1);
  }
}

function configure(app: INestApplication) {
  const { httpAdapter } = app.get(HttpAdapterHost);
  const cls = app.get(ClsService);
  const reflector = app.get(Reflector);

  app.useLogger(app.get(CustomLoggerService));

  app.useGlobalInterceptors(new HttpRequestLoggingInterceptor(cls, reflector));
  app.useGlobalInterceptors(new KafkaRequestLoggingInterceptor(cls, reflector));
  app.useGlobalInterceptors(new GrpcRequestLoggingInterceptor(cls, reflector));

  app.useGlobalFilters(new UnknownExceptionsFilter(httpAdapter));
  app.useGlobalFilters(new DefaultValidateExceptionFilter(httpAdapter));
  app.useGlobalFilters(new DefaultInternalExceptionFilter(httpAdapter));
  app.useGlobalFilters(new DefaultUnauthorizedExceptionFilter(httpAdapter));
  app.useGlobalFilters(new HttpExceptionFilter(httpAdapter));

  app.useGlobalPipes(new ValidationPipe(DefaultValidationOptions));

  app.enableShutdownHooks();
}

async function startHttp(app: INestApplication) {
  const configs = app.get(AppConfigService);
  await app.listen(configs.port);
}

async function startEvent(app: INestApplication) {
  const configs = app.get(AppConfigService);
  app.connectMicroservice(
    {
      ...getKafkaConfigs(configs),
    },
    {
      inheritAppConfig: true,
    },
  );

  await app.startAllMicroservices();
}

async function startGrpc(app: INestApplication) {
  const configs = app.get<AppConfigService>(AppConfigService);
  app.connectMicroservice(
    {
      ...getGRPCConfigs(configs),
    },
    {
      inheritAppConfig: true,
    },
  );
}

function logAppEnv(logger: LoggerService) {
  logger.log(`Environment: ${process.env['NODE_ENV']?.toUpperCase()}`);
}

function logAppPath(app: INestApplication, logger: LoggerService) {
  const configs = app.get(AppConfigService);
  const HOST = configs.host;
  const PORT = configs.port;

  if (process.env['NODE_ENV'] !== 'production') {
    logger.log(`Server HTTP ready at http://${HOST}:${PORT}`);
  } else {
    logger.log(`Server HTTP is listening on port ${PORT}`);
  }
}

bootstrap().catch((e) => {
  const stack = e instanceof Error ? e.stack : '';
  logger.error(`Error starting server, ${e}`, stack, 'Bootstrap');
  throw e;
});
