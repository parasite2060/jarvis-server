import * as express from 'express';
import { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Story 13.20 (SEC-03) originally capped the body at 10mb to prevent a
 * large-payload crash. Real session transcripts reach ~20mb, so the cap is
 * raised to a configurable default of 50mb. Anything larger is rejected by
 * Express's body parser, which NestJS surfaces as a 413 PayloadTooLarge
 * (handled by HttpExceptionFilter). MAX_BODY_SIZE overrides without a rebuild.
 *
 * Single source of truth shared by main.ts (prod) and the e2e harness so the
 * two can never drift again.
 */
export const DEFAULT_MAX_BODY_SIZE = '50mb';

export function resolveMaxBodySize(): string {
  return process.env['MAX_BODY_SIZE'] ?? DEFAULT_MAX_BODY_SIZE;
}

export function configureBodyParsers(app: NestExpressApplication): void {
  const limit = resolveMaxBodySize();
  app.use(express.json({ limit }));
  app.use(express.urlencoded({ extended: true, limit }));
}
