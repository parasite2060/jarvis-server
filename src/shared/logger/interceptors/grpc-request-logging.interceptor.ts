/* eslint-disable @typescript-eslint/no-explicit-any */
import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { transformGrpcRequest } from '../utils/request.transformer';
import { transformGrpcResponseBody } from '../utils/response.transformer';
import { Reflector } from '@nestjs/core';
import { isSilentRequestLog } from '../decorators/silent-request-log.decorators';
import { isSilentResponseLog } from '../decorators/silent-response-log.decorators';
import { PatternMetadata } from '@nestjs/microservices';
import { PATTERN_METADATA } from '@nestjs/microservices/constants';

@Injectable()
export class GrpcRequestLoggingInterceptor implements NestInterceptor {
  private readonly logger: Logger = new Logger(GrpcRequestLoggingInterceptor.name);

  private readonly cachedPaths: Map<(...args: any[]) => any, GrPcPath> = new Map<(...args: any[]) => any, GrPcPath>();

  constructor(
    private readonly cls: ClsService,
    private readonly reflector: Reflector,
  ) {}

  public intercept(context: ExecutionContext, call$: CallHandler): Observable<unknown> {
    const requestType = this.cls.get('requestType');
    if (requestType === 'GRPC') {
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

  private logRequest(execution: ExecutionContext): void {
    const path = this.getCachedGrpcPath(execution);

    this.logger.log({
      message: `[GRPC] Incoming request - ${path.service} - ${path.method}`,
      request: transformGrpcRequest(this.reflector, execution, path),
    });
  }

  private logResponse(body: any, execution: ExecutionContext): void {
    const path = this.getCachedGrpcPath(execution);

    this.logger.log({
      message: `[GRPC] Outgoing response - ${path.service} - ${path.method}`,
      response: {
        body: transformGrpcResponseBody(this.reflector, execution, body),
        service: path.service,
        method: path.method,
      },
    });
  }

  private logError(error: Error, execution: ExecutionContext): void {
    const path = this.getCachedGrpcPath(execution);

    if ((error as any)['status']) {
      const statusCode: number = (error as any)['status'];
      if (statusCode >= 500) {
        this.logger.error({
          message: `[GRPC] Outgoing response - ${statusCode} - ${path.service} - ${path.method}`,
          error: error,
        });
      } else {
        this.logger.warn({
          message: `[GRPC] Outgoing response - ${statusCode} - ${path.service} - ${path.method}`,
          error: {
            message: error.message,
          },
        });
      }
    } else {
      this.logger.error({
        message: `[GRPC] Outgoing response - ERROR - ${path.service} - ${path.method}`,
        error: error,
      });
    }
  }

  private getCachedGrpcPath(execution: ExecutionContext): GrPcPath {
    const handler = execution.getHandler() as (...args: any[]) => any;
    const cachedPath = this.cachedPaths.get(handler);
    if (cachedPath) {
      return cachedPath;
    }

    const path = this.getGrpcPath(execution);
    this.cachedPaths.set(handler, path);
    return path;
  }

  private getGrpcPath(execution: ExecutionContext): GrPcPath {
    const handler = execution.getHandler() as (...args: any[]) => any;
    const patterns = Reflect.getMetadata(PATTERN_METADATA, handler) as PatternMetadata[];

    if (patterns && patterns.length > 0) {
      const pattern = patterns[0] as any;
      return {
        service: pattern['service'],
        method: pattern['rpc'],
      };
    }

    return { service: 'unknown', method: 'unknown' };
  }
}

type GrPcPath = {
  service: string;
  method: string;
};
