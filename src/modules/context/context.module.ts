/**
 * ContextModule — Story 13.5.
 *
 * Module-local `CacheModule.register({ ttl: 30 * 60 * 1000 })` per Q1 — no
 * other module needs the assembled-context cache, so global registration is
 * not required. `ContextCacheService` is the only consumer of `CACHE_MANAGER`
 * from this module.
 */
import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ContextController } from './context.controller';
import { CommandHandlers } from './commands/handlers';
import { ContextCacheService } from './services/context-cache.service';
import { UseCases } from './usecases';

@Module({
  imports: [CacheModule.register({ ttl: 30 * 60 * 1000 })],
  controllers: [ContextController],
  providers: [...UseCases, ...CommandHandlers, ContextCacheService],
})
export class ContextModule {}
