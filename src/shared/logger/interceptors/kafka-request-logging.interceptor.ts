/* eslint-disable @typescript-eslint/no-explicit-any */
import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor, HttpException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { KafkaContext } from '@nestjs/microservices';
import { getHttpCode } from '../utils/http-code.utils';
import { RpcApiResponse } from 'src/utils/api-rpc.response';
import { transformKafkaResponseBody } from '../utils/response.transformer';
import { transformKafkaRequest } from '../utils/request.transformer';
import { isSilentResponseLog } from '../decorators/silent-response-log.decorators';
import { isSilentRequestLog } from '../decorators/silent-request-log.decorators';
import { Reflector } from '@nestjs/core';
import { BaseException } from 'src/shared/common/models/exception';

@Injectable()
export class KafkaRequestLoggingInterceptor implements NestInterceptor {
  private readonly logger: Logger = new Logger(KafkaRequestLoggingInterceptor.name);

  constructor(
    private readonly cls: ClsService,
    private readonly reflector: Reflector,
  ) {}

  public intercept(context: ExecutionContext, call$: CallHandler): Observable<unknown> {
    const requestType = this.cls.get('requestType');
    if (requestType === 'KAFKA') {
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
    const args = context.getArgs();
    const kafkaContext = args[1] as KafkaContext;
    const message = kafkaContext.getMessage();

    const request = {
      topic: kafkaContext.getTopic(),
      partition: kafkaContext.getPartition(),
      message: transformKafkaRequest(this.reflector, context, message),
    };

    this.logger.log({
      message: `[KAFKA] Incoming message - ${request.topic} - ${request.partition} - ${request.message?.key ?? '(empty)'}`,
      request: request,
    });
  }

  private logResponse(body: any, context: ExecutionContext): void {
    const args = context.getArgs();
    const kafkaContext = args[1] as KafkaContext;
    const status = body?.status ?? '(empty)';
    const request = {
      topic: kafkaContext.getTopic(),
      partition: kafkaContext.getPartition(),
      message: kafkaContext.getMessage(),
    };

    const response = {
      topic: request.message?.headers?.['kafka_replyTopic'],
      partition: request.message?.headers?.['kafka_replyPartition'],
      correlation: request.message?.headers?.['kafka_correlationId'],
    };

    this.logger.log({
      message: `[KAFKA] Outgoing response - ${status} - ${request.topic} - ${request.partition} - ${request.message?.key ?? '(empty)'}`,
      response: response,
      body: transformKafkaResponseBody(this.reflector, context, body),
    });
  }

  private logError(error: Error, context: ExecutionContext): void {
    const args = context.getArgs();
    const kafkaContext = args[1] as KafkaContext;
    const request = {
      topic: kafkaContext.getTopic(),
      partition: kafkaContext.getPartition(),
      message: kafkaContext.getMessage(),
    };
    const response = {
      topic: request.message?.headers?.['kafka_replyTopic'],
      partition: request.message?.headers?.['kafka_replyPartition'],
      correlation: request.message?.headers?.['kafka_correlationId'],
    };

    if (error instanceof BaseException) {
      this.logger.error({
        message: `[KAFKA] Outgoing response - ${getHttpCode(error)} - ${request.topic} - ${request.partition} - ${request.message?.key ?? '(empty)'}`,
        response: response,
        error: error,
        body: {
          value: new RpcApiResponse({
            status: getHttpCode(error) ?? undefined,
            code: error.code,
            message: error.message,
          }),
        },
      });
    } else if (error instanceof HttpException) {
      this.logger.error({
        message: `[KAFKA] Outgoing response - ${error.getStatus()} - ${request.topic} - ${request.partition} - ${request.message?.key ?? '(empty)'}`,
        response: error.getResponse(),
        error: error,
      });
    } else {
      this.logger.error({
        message: `[KAFKA] Outgoing response - ERROR - ${request.topic} - ${request.partition} - ${request.message?.key ?? '(empty)'}`,
        response: response,
        error: error,
      });
    }
  }
}
