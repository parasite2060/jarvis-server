import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import pino, { Logger, stdTimeFunctions } from 'pino';
import { LogMeta, NormalizeArgs, NormalizedLog, normalizeError, normalizeLog, normalizeWarn } from '../internal/message-normalizer';
import { createPinoDestination } from '../internal/pino-destination.factory';
import { CUSTOM_LOGGER_OPTION, CustomLoggerOptions } from '../model/logger-options';
import { getCallerFile } from '../utils/caller.utils';

const CALLER_STACK_DEPTH = 4;

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
          level: (label, number) => ({ severity: label, level: number }),
        },
      },
      createPinoDestination(options),
    );
  }

  setContext(context: string): void {
    this.context = context;
  }

  log(message: unknown, context?: string): void {
    const normalized = this.normalize(normalizeLog, { payload: message, caller: context ?? this.context, baseMeta: this.baseMeta() });
    this.logger.info(normalized.meta, normalized.message);
  }

  error(message: unknown, trace?: string, context?: string): void {
    const normalized = this.normalize(normalizeError, {
      payload: message,
      caller: context ?? this.context,
      trace,
      baseMeta: this.baseMeta(),
    });
    this.logger.error(normalized.meta, normalized.message);
  }

  warn(message: unknown, context?: string): void {
    const normalized = this.normalize(normalizeWarn, { payload: message, caller: context ?? this.context, baseMeta: this.baseMeta() });
    this.logger.warn(normalized.meta, normalized.message);
  }

  debug(message: unknown, context?: string): void {
    const normalized = this.normalize(normalizeLog, { payload: message, caller: context ?? this.context, baseMeta: this.baseMeta() });
    this.logger.debug(normalized.meta, normalized.message);
  }

  verbose(message: unknown, context?: string): void {
    const normalized = this.normalize(normalizeLog, { payload: message, caller: context ?? this.context, baseMeta: this.baseMeta() });
    this.logger.trace(normalized.meta, normalized.message);
  }

  private normalize(fn: (args: NormalizeArgs) => NormalizedLog, args: NormalizeArgs): NormalizedLog {
    return fn(args);
  }

  private baseMeta(): LogMeta {
    return {
      requestId: this.cls.getId(),
      ...this.gcpFields(),
      ...this.sourceField(),
    };
  }

  private gcpFields(): LogMeta {
    if (!this.options.gcpProperties) return {};
    return { 'logging.googleapis.com/spanId': this.cls.getId() };
  }

  private sourceField(): LogMeta {
    if (!this.options.source) return {};
    return { source: getCallerFile(CALLER_STACK_DEPTH, ['dist', 'node_modules'], 'dist') };
  }
}
