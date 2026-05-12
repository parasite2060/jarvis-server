/**
 * AuthModule — Story 13.19.
 *
 * Registers ApiKeyGuard globally via APP_GUARD. IS_PUBLIC_KEY and @Public()
 * decorator are exported for use by controllers.
 */
import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiKeyGuard } from './guards/api-key.guard';

@Global()
@Module({
  providers: [
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
  ],
  exports: [ApiKeyGuard],
})
export class AuthModule {}
