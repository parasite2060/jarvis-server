import { ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { Request, Response } from 'express';
import { logLevelByStatus } from '../internal/log-level-by-status';
import { transformHttpRequest } from '../utils/request.transformer';
import { transformHttpResponseBody } from '../utils/response.transformer';
import { serializeResponse } from '../utils/serializers.utils';
import { getHttpCode } from '../utils/http-code.utils';
import { HttpApiResponse } from 'src/utils/api-http.response';
import { BaseException } from 'src/shared/common/models/exception';
import { RequestLoggingInterceptor } from './request-logging.interceptor';

@Injectable()
export class HttpRequestLoggingInterceptor extends RequestLoggingInterceptor {
  protected get transport(): 'HTTP' {
    return 'HTTP';
  }

  protected logRequest(context: ExecutionContext): void {
    const request = context.switchToHttp().getRequest<Request>();

    this.logger.log({
      message: this.formatMessage('Incoming request', request, undefined),
      request: transformHttpRequest(this.reflector, context, request),
    });
  }

  protected logResponse(body: unknown, context: ExecutionContext): void {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const message = this.formatMessage('Outgoing response', request, response.statusCode);
    const meta = {
      response: serializeResponse(response),
      body: transformHttpResponseBody(this.reflector, context, body),
    };

    this.emit(logLevelByStatus(response.statusCode), { message, ...meta });
  }

  protected logError(error: Error, context: ExecutionContext): void {
    const request = context.switchToHttp().getRequest<Request>();

    if (error instanceof HttpException) {
      this.logHttpException(error, request);
      return;
    }

    if (error instanceof BaseException) {
      this.logBaseException(error, request);
      return;
    }

    this.logger.error({
      message: this.formatMessage('Outgoing response', request, 'ERROR'),
      error,
    });
  }

  private logHttpException(error: HttpException, request: Request): void {
    const statusCode = error.getStatus();
    const message = this.formatMessage('Outgoing response', request, statusCode);

    if (logLevelByStatus(statusCode) === 'error') {
      this.logger.error({ message, error });
      return;
    }

    this.logger.warn({ message, response: error.getResponse(), error });
  }

  private logBaseException(error: BaseException, request: Request): void {
    const status = getHttpCode(error);
    this.logger.error({
      message: this.formatMessage('Outgoing response', request, status),
      error,
      response: new HttpApiResponse({ code: error.code, message: error.message }),
    });
  }

  private formatMessage(phase: string, request: Request, status: number | string | null | undefined): string {
    const statusPart = status ?? '';
    return `[HTTP] ${phase} - ${statusPart} - ${request.method} - ${request.url}`;
  }

  private emit(level: 'log' | 'warn' | 'error', payload: Record<string, unknown>): void {
    this.logger[level](payload);
  }
}
