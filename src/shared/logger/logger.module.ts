import { DynamicModule, ExecutionContext, Module } from '@nestjs/common';
import { ClsModule, ClsService } from 'nestjs-cls';
import { randomId } from './internal/random-id';
import { detectRequestType, RequestType } from './internal/transport-detector';
import { CUSTOM_LOGGER_OPTION, LoggerModuleOptions } from './model/logger-options';
import { CustomLoggerService } from './services/custom-logger.service';

@Module({})
export class LoggerModule {
  static forRoot(options?: LoggerModuleOptions): DynamicModule {
    const merged = { ...new LoggerModuleOptions(), ...options };

    return {
      module: LoggerModule,
      imports: [
        ClsModule.forRoot({
          global: merged.global,
          interceptor: {
            generateId: true,
            idGenerator: (ctx) => generateId(ctx, merged),
            setup: (cls, ctx) => runSetup(cls, ctx, merged),
            mount: true,
          },
        }),
      ],
      providers: [{ provide: CUSTOM_LOGGER_OPTION, useValue: merged }, CustomLoggerService],
      exports: [CustomLoggerService, ClsModule],
      global: merged.global,
    };
  }
}

function runSetup(cls: ClsService, context: ExecutionContext, options: LoggerModuleOptions): void {
  const requestType = detectRequestType(context);
  cls.set('requestType', requestType);

  const args = context.getArgs();
  const setupByType: Record<RequestType, () => void> = {
    KAFKA: () => options.kafka!.setup(cls, args[1], args[0], options),
    GRPC: () => options.grpc!.setup(cls, args[1], args[0], options),
    HTTP: () => options.http!.setup(cls, args[0], args[1], options),
  };

  setupByType[requestType]();
}

function generateId(context: ExecutionContext, options: LoggerModuleOptions): string {
  const requestType = detectRequestType(context);
  const args = context.getArgs();

  if (requestType === 'KAFKA') return options.kafka!.idGenerator(args[1], args[0]);
  if (requestType === 'GRPC') return options.grpc!.idGenerator(args[1], args[0]);
  if (args[0]?.url) return (args[0]['id'] = options.http!.idGenerator(args[0], args[1]));

  return randomId();
}
