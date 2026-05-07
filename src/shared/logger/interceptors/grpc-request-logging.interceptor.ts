/* eslint-disable @typescript-eslint/no-explicit-any */
import { ExecutionContext, Injectable } from '@nestjs/common';
import { PatternMetadata } from '@nestjs/microservices';
import { PATTERN_METADATA } from '@nestjs/microservices/constants';
import { logLevelByStatus } from '../internal/log-level-by-status';
import { transformGrpcRequest } from '../utils/request.transformer';
import { transformGrpcResponseBody } from '../utils/response.transformer';
import { RequestLoggingInterceptor } from './request-logging.interceptor';

interface GrpcPath {
  service: string;
  method: string;
}

const UNKNOWN_PATH: GrpcPath = { service: 'unknown', method: 'unknown' };

@Injectable()
export class GrpcRequestLoggingInterceptor extends RequestLoggingInterceptor {
  private readonly pathCache = new Map<(...args: any[]) => any, GrpcPath>();

  protected get transport(): 'GRPC' {
    return 'GRPC';
  }

  protected logRequest(context: ExecutionContext): void {
    const path = this.pathOf(context);

    this.logger.log({
      message: this.formatMessage('Incoming request', path, undefined),
      request: transformGrpcRequest(this.reflector, context, path),
    });
  }

  protected logResponse(body: unknown, context: ExecutionContext): void {
    const path = this.pathOf(context);

    this.logger.log({
      message: this.formatMessage('Outgoing response', path, undefined),
      response: {
        body: transformGrpcResponseBody(this.reflector, context, body),
        service: path.service,
        method: path.method,
      },
    });
  }

  protected logError(error: Error, context: ExecutionContext): void {
    const path = this.pathOf(context);
    const status = (error as any)['status'] as number | undefined;

    if (typeof status !== 'number') {
      this.logger.error({
        message: this.formatMessage('Outgoing response', path, 'ERROR'),
        error,
      });
      return;
    }

    if (logLevelByStatus(status) === 'error') {
      this.logger.error({ message: this.formatMessage('Outgoing response', path, status), error });
      return;
    }

    this.logger.warn({
      message: this.formatMessage('Outgoing response', path, status),
      error: { message: error.message },
    });
  }

  private pathOf(context: ExecutionContext): GrpcPath {
    const handler = context.getHandler() as (...args: any[]) => any;
    const cached = this.pathCache.get(handler);
    if (cached) return cached;

    const path = this.readPathFromMetadata(handler);
    this.pathCache.set(handler, path);
    return path;
  }

  private readPathFromMetadata(handler: (...args: any[]) => any): GrpcPath {
    const patterns = Reflect.getMetadata(PATTERN_METADATA, handler) as PatternMetadata[] | undefined;
    if (!patterns || patterns.length === 0) return UNKNOWN_PATH;

    const pattern = patterns[0] as { service?: string; rpc?: string };
    return {
      service: pattern.service ?? UNKNOWN_PATH.service,
      method: pattern.rpc ?? UNKNOWN_PATH.method,
    };
  }

  private formatMessage(phase: string, path: GrpcPath, status: number | string | null | undefined): string {
    const statusPart = status === undefined ? '' : `${status} - `;
    return `[GRPC] ${phase} - ${statusPart}${path.service} - ${path.method}`;
  }
}
