/* eslint-disable @typescript-eslint/no-explicit-any */
import { ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { KafkaContext } from '@nestjs/microservices';
import { BaseException } from 'src/shared/common/models/exception';
import { RpcApiResponse } from 'src/utils/api-rpc.response';
import { getHttpCode } from '../utils/http-code.utils';
import { transformKafkaRequest } from '../utils/request.transformer';
import { transformKafkaResponseBody } from '../utils/response.transformer';
import { RequestLoggingInterceptor } from './request-logging.interceptor';

interface KafkaCoords {
  topic: string;
  partition: number;
  key: string;
}

interface KafkaReplyHeaders {
  topic: unknown;
  partition: unknown;
  correlation: unknown;
}

@Injectable()
export class KafkaRequestLoggingInterceptor extends RequestLoggingInterceptor {
  protected get transport(): 'KAFKA' {
    return 'KAFKA';
  }

  protected logRequest(context: ExecutionContext): void {
    const kafkaContext = this.kafkaContextOf(context);
    const message = kafkaContext.getMessage();
    const coords = this.coordsOf(kafkaContext);

    this.logger.log({
      message: this.formatMessage('Incoming message', coords, undefined),
      request: {
        topic: coords.topic,
        partition: coords.partition,
        message: transformKafkaRequest(this.reflector, context, message),
      },
    });
  }

  protected logResponse(body: any, context: ExecutionContext): void {
    const kafkaContext = this.kafkaContextOf(context);
    const coords = this.coordsOf(kafkaContext);
    const status = body?.status ?? '(empty)';

    this.logger.log({
      message: this.formatMessage('Outgoing response', coords, status),
      response: this.replyHeadersOf(kafkaContext),
      body: transformKafkaResponseBody(this.reflector, context, body),
    });
  }

  protected logError(error: Error, context: ExecutionContext): void {
    const kafkaContext = this.kafkaContextOf(context);
    const coords = this.coordsOf(kafkaContext);
    const replyHeaders = this.replyHeadersOf(kafkaContext);

    if (error instanceof BaseException) {
      const status = getHttpCode(error);
      this.logger.error({
        message: this.formatMessage('Outgoing response', coords, status),
        response: replyHeaders,
        error,
        body: {
          value: new RpcApiResponse({ status: status ?? undefined, code: error.code, message: error.message }),
        },
      });
      return;
    }

    if (error instanceof HttpException) {
      this.logger.error({
        message: this.formatMessage('Outgoing response', coords, error.getStatus()),
        response: error.getResponse(),
        error,
      });
      return;
    }

    this.logger.error({
      message: this.formatMessage('Outgoing response', coords, 'ERROR'),
      response: replyHeaders,
      error,
    });
  }

  private kafkaContextOf(context: ExecutionContext): KafkaContext {
    return context.getArgs()[1] as KafkaContext;
  }

  private coordsOf(kafkaContext: KafkaContext): KafkaCoords {
    const message = kafkaContext.getMessage();
    return {
      topic: kafkaContext.getTopic(),
      partition: kafkaContext.getPartition(),
      key: message?.key?.toString() ?? '(empty)',
    };
  }

  private replyHeadersOf(kafkaContext: KafkaContext): KafkaReplyHeaders {
    const headers = kafkaContext.getMessage()?.headers ?? {};
    return {
      topic: headers['kafka_replyTopic'],
      partition: headers['kafka_replyPartition'],
      correlation: headers['kafka_correlationId'],
    };
  }

  private formatMessage(phase: string, coords: KafkaCoords, status: number | string | null | undefined): string {
    const statusPart = status ?? '';
    return `[KAFKA] ${phase} - ${statusPart} - ${coords.topic} - ${coords.partition} - ${coords.key}`;
  }
}
