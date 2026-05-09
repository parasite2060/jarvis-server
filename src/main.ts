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
  VaultFileNotFoundExceptionFilter,
  VaultPathTraversalExceptionFilter,
  VaultEndpointFileNotFoundExceptionFilter,
  VaultEndpointPathTraversalExceptionFilter,
  MemuErrorExceptionFilter,
  MemuUnavailableExceptionFilter,
} from './utils/filter/exception.filter';
import { CustomLoggerService } from './shared/logger/services/custom-logger.service';
import { ClsService } from 'nestjs-cls';
import { HttpRequestLoggingInterceptor } from './shared/logger/interceptors/http-request-logging.interceptor';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DefaultValidationOptions } from './utils/config/validation.config';
import { AppConfigService } from './shared/config/config.service';
import { TemporalClientService } from './shared/temporal/temporal-client.service';
import { TemporalWorkerService } from './shared/temporal/temporal-worker.service';
import { loadCronConfigFromVault } from './shared/temporal/load-cron-config';
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
    await startTemporalWorker(app);
    await ensureCoordinatorRunning(app);
    await registerSchedules(app);

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

  app.useGlobalFilters(new UnknownExceptionsFilter(httpAdapter));
  app.useGlobalFilters(new DefaultValidateExceptionFilter(httpAdapter));
  app.useGlobalFilters(new DefaultInternalExceptionFilter(httpAdapter));
  app.useGlobalFilters(new DefaultUnauthorizedExceptionFilter(httpAdapter));
  app.useGlobalFilters(new HttpExceptionFilter(httpAdapter));
  // Story 13.4 — vault read + MemU client typed exceptions.
  app.useGlobalFilters(new VaultFileNotFoundExceptionFilter(httpAdapter));
  app.useGlobalFilters(new VaultPathTraversalExceptionFilter(httpAdapter));
  app.useGlobalFilters(new VaultEndpointFileNotFoundExceptionFilter(httpAdapter));
  app.useGlobalFilters(new VaultEndpointPathTraversalExceptionFilter(httpAdapter));
  app.useGlobalFilters(new MemuErrorExceptionFilter(httpAdapter));
  app.useGlobalFilters(new MemuUnavailableExceptionFilter(httpAdapter));

  app.useGlobalPipes(new ValidationPipe(DefaultValidationOptions));

  app.enableShutdownHooks();
}

async function startHttp(app: INestApplication) {
  const configs = app.get(AppConfigService);
  await app.listen(configs.port);
}

/**
 * Story 13.8 — boot the co-located Temporal worker AFTER `app.init()` so
 * activity providers can resolve their NestJS DI before Temporal invokes
 * them. Q9 = (b) defensive: missing workflow path / empty activity map
 * short-circuits gracefully so 13.8 ships HTTP-only out of the box; the
 * first dream workflow / activity (Stories 13.9–13.12) flips the worker on
 * across the next process boot.
 */
async function startTemporalWorker(app: INestApplication) {
  const workerService = app.get(TemporalWorkerService);
  const configs = app.get(AppConfigService);
  await workerService.start({
    taskQueue: configs.temporalTaskQueue,
    workflowsPath: tryResolveWorkflowsPath(),
    activities: workerService.collectActivities(app),
    workflowsRegistered: ['dreamCoordinatorWorkflow', 'LightDream', 'DeepDream', 'WeeklyReview', 'ScheduleSignalRelay'],
  });
}

function tryResolveWorkflowsPath(): string {
  try {
    return require.resolve('./modules/dream/temporal/workflows');
  } catch {
    return '';
  }
}

/**
 * Story 13.9 — start the singleton `coord-singleton` workflow once the
 * worker has booted. Skipped when the worker short-circuited.
 */
async function ensureCoordinatorRunning(app: NestExpressApplication) {
  const workerService = app.get(TemporalWorkerService);
  if (!workerService.isStarted()) {
    logger.warn({
      message: 'temporal coordinator start deferred — worker not booted',
      event: 'main.coordinatorStart.deferred',
      reason: 'workerNotBooted',
    });
    return;
  }

  try {
    await app.get(TemporalClientService).ensureCoordinatorRunning();
    logger.log({
      message: 'temporal coordinator start completed',
      event: 'main.coordinatorStart.completed',
      workflowId: 'coord-singleton',
    });
  } catch (err) {
    logger.error({
      message: 'temporal coordinator start failed',
      event: 'main.coordinatorStart.failed',
      errorClass: (err as { name?: string })?.name ?? 'Error',
    });
    throw err;
  }
}

/**
 * Story 13.13 — register Temporal Schedules at boot.
 */
async function registerSchedules(app: NestExpressApplication) {
  const workerService = app.get(TemporalWorkerService);
  if (!workerService.isStarted()) {
    logger.warn({
      message: 'temporal schedule registration deferred — worker not booted',
      event: 'main.registerSchedules.deferred',
      reason: 'workerNotBooted',
    });
    return;
  }

  try {
    const cronConfig = await loadCronConfigFromVault(app);
    await app.get(TemporalClientService).registerSchedules({
      deepDreamCron: cronConfig.deepDreamCron,
      weeklyReviewCron: cronConfig.weeklyReviewCron,
    });
    logger.log({
      message: 'temporal schedule registration completed',
      event: 'main.registerSchedules.completed',
      scheduleIds: ['deep-dream-nightly', 'weekly-review'],
    });
  } catch (err) {
    logger.warn({
      message: 'temporal schedule registration degraded — continuing boot (will self-heal on next start)',
      event: 'main.registerSchedules.failed',
      errorClass: (err as { name?: string })?.name ?? 'Error',
      error: (err as Error).message,
    });
  }
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
