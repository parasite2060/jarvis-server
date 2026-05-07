import { ExecutionContext, SetMetadata } from '@nestjs/common';
import { SILENT_RESPONSE_BODY_METADATA } from '../utils/constrants';
import { Reflector } from '@nestjs/core';

export const SilentResponseBody = (enable = true): MethodDecorator => SetMetadata(SILENT_RESPONSE_BODY_METADATA, enable);

export function isSilentResponseBody(reflector: Reflector, context: ExecutionContext): boolean {
  const isSilentHandler = reflector.getAllAndOverride<boolean>(SILENT_RESPONSE_BODY_METADATA, [context.getHandler(), context.getClass()]);

  return isSilentHandler || false;
}
