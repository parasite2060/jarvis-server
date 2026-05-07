/* eslint-disable @typescript-eslint/no-explicit-any */
import { Metadata } from '@grpc/grpc-js';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { KafkaMessage } from 'kafkajs';
import { isSilentRequestBody } from '../decorators/silent.decorator';
import { serializeRequest } from './serializers.utils';

const SILENT_PLACEHOLDER = '(silent)';

export interface GrpcPath {
  service: string;
  method: string;
}

export function transformHttpRequest(reflector: Reflector, context: ExecutionContext, request: Request): Record<string, any> {
  const serialized = serializeRequest(request);
  if (isSilentRequestBody(reflector, context) && serialized['body']) {
    serialized['body'] = SILENT_PLACEHOLDER;
  }
  return serialized;
}

export function transformKafkaRequest(reflector: Reflector, context: ExecutionContext, message: KafkaMessage): Record<string, any> {
  const cloned: Record<string, any> = { ...message };
  if (isSilentRequestBody(reflector, context) && cloned['value']) {
    cloned['value'] = SILENT_PLACEHOLDER;
  }
  return cloned;
}

export function transformGrpcRequest(reflector: Reflector, context: ExecutionContext, path: GrpcPath): Record<string, any> {
  const data = context.switchToRpc().getData();
  const metadata = context.switchToRpc().getContext() as Metadata;
  const isSilent = isSilentRequestBody(reflector, context);

  return {
    metadata: metadata.getMap(),
    data: isSilent && data ? SILENT_PLACEHOLDER : data,
    service: path.service,
    method: path.method,
  };
}
