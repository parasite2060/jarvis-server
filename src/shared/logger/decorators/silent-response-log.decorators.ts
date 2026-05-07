import { ExecutionContext, SetMetadata } from '@nestjs/common';
import { SILENT_RESPONSE_LOG_METADATA } from '../utils/constrants';
import { Reflector } from '@nestjs/core';

export const SilentResponseLog = (enable = true): MethodDecorator => SetMetadata(SILENT_RESPONSE_LOG_METADATA, enable);

export function isSilentResponseLog(reflector: Reflector, context: ExecutionContext): boolean {
  const isSilentHandler = reflector.getAllAndOverride<boolean>(SILENT_RESPONSE_LOG_METADATA, [context.getHandler(), context.getClass()]);

  return isSilentHandler || false;
}
