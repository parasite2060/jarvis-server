/* eslint-disable @typescript-eslint/no-explicit-any */
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { isSilentRequestBody } from '../decorators/silent.decorator';
import { serializeRequest } from './serializers.utils';

const SILENT_PLACEHOLDER = '(silent)';

export function transformHttpRequest(reflector: Reflector, context: ExecutionContext, request: Request): Record<string, any> {
  const serialized = serializeRequest(request);
  if (isSilentRequestBody(reflector, context) && serialized['body']) {
    serialized['body'] = SILENT_PLACEHOLDER;
  }
  return serialized;
}
