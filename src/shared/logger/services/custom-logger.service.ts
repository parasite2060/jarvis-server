/* eslint-disable @typescript-eslint/no-explicit-any */
import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { CUSTOM_LOGGER_OPTION, CustomLoggerOptions } from '../model/logger.option';
import { ClsService } from 'nestjs-cls';
import { getCallerFile } from '../utils/caller.utils';
import pino, { DestinationStream, Logger, stdTimeFunctions } from 'pino';
import * as fs from 'fs';

function getPinoDest(options: CustomLoggerOptions): DestinationStream | null {
  if (options.logFile) {
    const dest = pino.destination({
      dest: options.logFile,
      minLength: 8192,
      maxWrite: 32768,
      sync: false,
    });

    fs.writeFileSync(options.syncFile!, process.pid.toString());
    process.on('SIGUSR2', () => dest.reopen());

    setInterval(() => {
      dest.flush();
    }, 5000);

    return dest;
  }

  if (options.output === 'text') {
    return pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        messageKey: 'message',
        ignore: 'hostname,severity',
      },
    });
  }

  return null;
}

@Injectable()
export class CustomLoggerService implements LoggerService {
  private context?: string;
  private readonly logger: Logger;

  constructor(
    private readonly cls: ClsService,
    @Inject(CUSTOM_LOGGER_OPTION)
    private readonly options: CustomLoggerOptions,
  ) {
    this.logger = pino(
      {
        timestamp: stdTimeFunctions.isoTime,
        level: options.level,
        messageKey: 'message',
        errorKey: 'error',
        formatters: {
          level(label, number) {
            return { severity: label, level: number };
          },
        },
      },
      getPinoDest(options) ?? undefined,
    );
  }

  public setContext(context: string): void {
    this.context = context;
  }

  public log(message: any, context?: string): any {
    context = context || this.context;

    if ('object' === typeof message) {
      const { message: msg, ...meta } = message;
      return this.logger.info({ ...this.addition(), caller: context, ...meta }, msg as string);
    }

    return this.logger.info({ ...this.addition(), caller: context }, message);
  }

  public error(message: any, trace?: string, context?: string): any {
    context = context || this.context;

    if (message instanceof Error) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { message: msg, name, stack, ...meta } = message;
      return this.logger.error({ ...this.addition(), caller: context ?? trace, stack: message.stack || trace, ...meta }, msg);
    }

    if ('object' === typeof message) {
      const { message: msg, error, ...meta } = message;
      if (error instanceof Error) {
        return this.logger.error(
          {
            ...this.addition(),
            caller: context ?? trace,
            stack: error.stack || (context ? trace : null),
            ...meta,
          },
          `${msg as string}`,
        );
      }

      return this.logger.error(
        {
          ...this.addition(),
          caller: context ?? trace,
          stack: context ? trace : null,
          error: error,
          ...meta,
        },
        msg as string,
      );
    }

    return this.logger.error({ ...this.addition(), caller: context ?? trace, stack: context ? trace : null }, message);
  }

  public warn(message: any, context?: string): any {
    context = context || this.context;

    if ('object' === typeof message) {
      const { message: msg, error, ...meta } = message;
      if (error instanceof Error) {
        return this.logger.warn({ ...this.addition(), caller: context, stack: error.stack, ...meta }, `${msg as string}`);
      }

      return this.logger.warn({ ...this.addition(), caller: context, ...meta }, msg as string);
    }

    return this.logger.warn({ ...this.addition(), caller: context }, message);
  }

  public debug?(message: any, context?: string): any {
    context = context || this.context;

    if ('object' === typeof message) {
      const { message: msg, ...meta } = message;
      return this.logger.debug({ ...this.addition(), caller: context, ...meta }, msg as string);
    }

    return this.logger.debug({ ...this.addition(), caller: context }, message);
  }

  public verbose?(message: any, context?: string): any {
    context = context || this.context;

    if ('object' === typeof message) {
      const { message: msg, ...meta } = message;
      return this.logger.trace({ ...this.addition(), caller: context, ...meta }, msg as string);
    }

    return this.logger.trace({ ...this.addition(), caller: context }, message);
  }

  private addition(): any {
    return {
      requestId: this.cls.getId(),
      ...this.getGcpProperties(),
      ...this.getSource(),
    };
  }

  private getGcpProperties(): any {
    if (this.options.gcpProperties) {
      return {
        'logging.googleapis.com/spanId': this.cls.getId(),
      };
    }

    return {};
  }

  private getSource(): any {
    if (this.options.source) {
      return {
        source: getCallerFile(4, ['dist', 'node_modules'], 'dist'),
      };
    }

    return {};
  }
}
