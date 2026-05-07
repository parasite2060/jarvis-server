import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isSilentResponseBody } from '../decorators/silent.decorator';

const SILENT_PLACEHOLDER = '(silent)';

export function transformResponseBody(reflector: Reflector, context: ExecutionContext, body: unknown): unknown {
  return isSilentResponseBody(reflector, context) ? SILENT_PLACEHOLDER : body;
}

export const transformHttpResponseBody = transformResponseBody;
export const transformKafkaResponseBody = transformResponseBody;
export const transformGrpcResponseBody = transformResponseBody;
