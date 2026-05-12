/**
 * AuthModule — Story 13.19.
 *
 * Registers ApiKeyGuard globally via APP_GUARD. IS_PUBLIC_KEY and @Public()
 * decorator are exported for use by controllers.
 */
import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiKeyGuard } from './guards/api-key.guard';
import { AppConfigModule } from 'src/shared/config/config.module';

@Global()
@Module({
  imports: [AppConfigModule],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
  ],
})
export class AuthModule {}
