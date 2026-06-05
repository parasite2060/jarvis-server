import { HttpStatus } from '@nestjs/common';

export type StatusLogLevel = 'log' | 'warn' | 'error';

export function logLevelByStatus(statusCode: number): StatusLogLevel {
  if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) return 'error';
  if (statusCode >= HttpStatus.BAD_REQUEST) return 'warn';
  return 'log';
}
