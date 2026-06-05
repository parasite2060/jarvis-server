import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { isSilentRequestLog, isSilentResponseLog } from '../decorators/silent.decorator';
import { RequestType } from '../internal/transport-detector';

/**
 * Base interceptor that handles the common skeleton:
 * - Match the current transport via cls
 * - Apply silent-log decorators
 * - Tap into the response stream and dispatch to logRequest / logResponse / logError
 *
 * Subclasses implement the transport-specific shaping methods.
 */
@Injectable()
export abstract class RequestLoggingInterceptor implements NestInterceptor {
  protected readonly logger: Logger = new Logger(this.constructor.name);

  constructor(
    protected readonly cls: ClsService,
    protected readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, call$: CallHandler): Observable<unknown> {
    if (this.cls.get<string>('requestType') !== this.transport) {
      return call$.handle();
    }

    if (!isSilentRequestLog(this.reflector, context)) {
      this.logRequest(context);
    }

    return call$.handle().pipe(
      tap({
        next: (value) => {
          if (!isSilentResponseLog(this.reflector, context)) {
            this.logResponse(value, context);
          }
        },
        error: (error: Error) => this.logError(error, context),
      }),
    );
  }

  protected abstract get transport(): RequestType;
  protected abstract logRequest(context: ExecutionContext): void;
  protected abstract logResponse(body: unknown, context: ExecutionContext): void;
  protected abstract logError(error: Error, context: ExecutionContext): void;
}
