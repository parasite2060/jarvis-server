import { ExecutionContext, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  SILENT_REQUEST_BODY_METADATA,
  SILENT_REQUEST_LOG_METADATA,
  SILENT_RESPONSE_BODY_METADATA,
  SILENT_RESPONSE_LOG_METADATA,
} from '../utils/constants';

function silentDecorator(metadataKey: string) {
  return (enable = true): MethodDecorator => SetMetadata(metadataKey, enable);
}

function isSilent(reflector: Reflector, context: ExecutionContext, metadataKey: string): boolean {
  return reflector.getAllAndOverride<boolean>(metadataKey, [context.getHandler(), context.getClass()]) ?? false;
}

export const SilentRequestLog = silentDecorator(SILENT_REQUEST_LOG_METADATA);
export const SilentResponseLog = silentDecorator(SILENT_RESPONSE_LOG_METADATA);
export const SilentRequestBody = silentDecorator(SILENT_REQUEST_BODY_METADATA);
export const SilentResponseBody = silentDecorator(SILENT_RESPONSE_BODY_METADATA);

export const isSilentRequestLog = (reflector: Reflector, context: ExecutionContext) => isSilent(reflector, context, SILENT_REQUEST_LOG_METADATA);
export const isSilentResponseLog = (reflector: Reflector, context: ExecutionContext) => isSilent(reflector, context, SILENT_RESPONSE_LOG_METADATA);
export const isSilentRequestBody = (reflector: Reflector, context: ExecutionContext) => isSilent(reflector, context, SILENT_REQUEST_BODY_METADATA);
export const isSilentResponseBody = (reflector: Reflector, context: ExecutionContext) => isSilent(reflector, context, SILENT_RESPONSE_BODY_METADATA);
