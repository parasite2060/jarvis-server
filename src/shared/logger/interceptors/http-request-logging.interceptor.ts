/* eslint-disable  @typescript-eslint/no-explicit-any */
import { CallHandler, ExecutionContext, HttpException, HttpStatus, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { serializeResponse } from '../utils/serializers.utils';
import { getHttpCode } from '../utils/http-code.utils';
import { transformHttpRequest } from '../utils/request.transformer';
import { transformHttpResponseBody } from '../utils/response.transformer';
import { Reflector } from '@nestjs/core';
import { HttpApiResponse } from 'src/utils/api-http.response';
import { isSilentRequestLog } from '../decorators/silent-request-log.decorators';
import { isSilentResponseLog } from '../decorators/silent-response-log.decorators';
import { BaseException } from 'src/shared/common/models/exception';

@Injectable()
export class HttpRequestLoggingInterceptor implements NestInterceptor {
  private readonly logger: Logger = new Logger(HttpRequestLoggingInterceptor.name);

  constructor(
    private readonly cls: ClsService,
    private readonly reflector: Reflector,
  ) {}

  public intercept(context: ExecutionContext, call$: CallHandler): Observable<unknown> {
    const requestType = this.cls.get('requestType');
    if (requestType === 'HTTP') {
      if (!isSilentRequestLog(this.reflector, context)) {
        this.logRequest(context);
      }

      return call$.handle().pipe(
        tap({
          next: (val: unknown): void => {
            if (!isSilentResponseLog(this.reflector, context)) {
              this.logResponse(val, context);
            }
          },
          error: (err: Error): void => {
            this.logError(err, context);
          },
        }),
      );
    }

    return call$.handle();
  }

  private logRequest(context: ExecutionContext): void {
    const request = context.switchToHttp().getRequest<Request>();
    this.logger.log({
      message: `[HTTP] Incoming request - ${request.method} - ${request.url}`,
      request: transformHttpRequest(this.reflector, context, request),
    });
  }

  private logResponse(body: any, context: ExecutionContext): void {
    const request: Request = context.switchToHttp().getRequest<Request>();
    const response: Response = context.switchToHttp().getResponse<Response>();
    const meta = {
      response: serializeResponse(response),
      body: transformHttpResponseBody(this.reflector, context, body),
    };

    if (response.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error({
        message: `[HTTP] Outgoing response - ${response.statusCode} - ${request.method} - ${request.url}`,
        ...meta,
      });
    } else if (response.statusCode >= HttpStatus.BAD_REQUEST) {
      this.logger.warn({
        message: `[HTTP] Outgoing response - ${response.statusCode} - ${request.method} - ${request.url}`,
        ...meta,
      });
    } else {
      this.logger.log({
        message: `[HTTP] Outgoing response - ${response.statusCode} - ${request.method} - ${request.url}`,
        ...meta,
      });
    }
  }

  private logError(error: Error, context: ExecutionContext): void {
    const request: Request = context.switchToHttp().getRequest<Request>();

    if (error instanceof HttpException) {
      const statusCode: number = error.getStatus();
      if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
        this.logger.error(
          {
            message: `[HTTP] Outgoing response - ${statusCode} - ${request.method} - ${request.url}`,
            error: error,
          },
          null,
        );
      } else {
        this.logger.warn({
          message: `[HTTP] Outgoing response - ${statusCode} - ${request.method} - ${request.url}`,
          response: error.getResponse(),
          error: error,
        });
      }
    } else if (error instanceof BaseException) {
      this.logger.error({
        message: `[HTTP] Outgoing response - ${getHttpCode(error)} - ${request.method} - ${request.url}`,
        error: error,
        response: new HttpApiResponse({
          code: error.code,
          message: error.message,
        }),
      });
    } else {
      this.logger.error({
        message: `[HTTP] Outgoing response - ERROR - ${request.method} - ${request.url}`,
        error: error,
      });
    }
  }
}
