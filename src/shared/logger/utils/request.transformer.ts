/* eslint-disable @typescript-eslint/no-explicit-any */
import { ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { KafkaMessage } from 'kafkajs';
import { serializeRequest } from './serializers.utils';
import { isSilentRequestBody } from '../decorators/silent-request-body.decorators';
import { Reflector } from '@nestjs/core';
import { Metadata } from '@grpc/grpc-js';

export function transformHttpRequest(reflector: Reflector, context: ExecutionContext, request: Request): any {
  const isSilentBody = isSilentRequestBody(reflector, context);
  const serializedRequest = serializeRequest(request);

  if (isSilentBody && serializedRequest['body']) {
    serializedRequest['body'] = '(silent)';
  }

  return serializedRequest;
}

export function transformKafkaRequest(reflector: Reflector, context: ExecutionContext, message: KafkaMessage): any {
  const isSilentBody = isSilentRequestBody(reflector, context);
  const serializedMessage = Object.assign({}, message);

  if (isSilentBody && serializedMessage.value) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    serializedMessage.value = '(silent)';
  }

  return serializedMessage;
}

export function transformGrpcRequest(reflector: Reflector, context: ExecutionContext, path: GrPcPath): any {
  const data = context.switchToRpc().getData();
  const metadata = context.switchToRpc().getContext() as Metadata;
  const isSilentBody = isSilentRequestBody(reflector, context);

  const serialized = {
    metadata: metadata.getMap(),
    data: data,
    service: path.service,
    method: path.method,
  };

  if (isSilentBody && serialized['data']) {
    serialized['data'] = '(silent)';
  }

  return serialized;
}

export type GrPcPath = {
  service: string;
  method: string;
};
