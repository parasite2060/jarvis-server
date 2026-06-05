import { DynamicModule, ExecutionContext, Module } from '@nestjs/common';
import { ClsModule, ClsService } from 'nestjs-cls';
import { randomId } from './internal/random-id';
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
  cls.set('requestType', 'HTTP');

  const args = context.getArgs();
  options.http!.setup(cls, args[0], args[1], options);
}

function generateId(context: ExecutionContext, options: LoggerModuleOptions): string {
  const args = context.getArgs();

  if (args[0]?.url) return (args[0]['id'] = options.http!.idGenerator(args[0], args[1]));

  return randomId();
}
