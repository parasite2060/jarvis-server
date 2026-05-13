/* istanbul ignore file */
import { Module } from '@nestjs/common';
import { ApiModule } from './shared/api/api.module';
import { HealthModule } from './shared/health/health.module';
import { getLoggerOptions } from './utils/config/logger.config';
import { LoggerModule } from './shared/logger/logger.module';
import { defaultRedisConfig } from './utils/config/redis.config';
import { CqrsModule } from '@nestjs/cqrs';
import { PostgresModule } from './shared/postgres/postgres.module';
import { AppConfigModule } from './shared/config/config.module';
import { AppConfigService } from './shared/config/config.service';

// Business modules
import { ConversationModule } from './modules/conversation/conversation.module';
import { ContextModule } from './modules/context/context.module';
import { DreamModule } from './modules/dream/dream.module';
import { MemoryModule } from './modules/memory/memory.module';
import { VaultModule } from './modules/vault/vault.module';
// Story 13.10.5 — config business module per module-map §1 lines 170-180.
// Distinct from `src/shared/config/` (boilerplate env-var loader; different scope).
import { ConfigModule as JarvisConfigModule } from './modules/config/config.module';
import { RedisModule } from '@nestjs-redis/kit';

// Shared (global) module — in-process domain event handler (Kafka publish neutered per architecture.md §6.8)
import { EventModule } from './shared/event/event.module';
// Shared (global) modules — Story 13.3 stubs
import { SecretRedactionModule } from './shared/secret-redaction/secret-redaction.module';
import { TemporalModule } from './shared/temporal/temporal.module';
// Shared (global) module — Story 13.7
import { GitModule } from './shared/git/git.module';
// Shared (global) module — Story 13.10
import { AgentsModule } from './shared/agents/agents.module';

// Shared (global) module — Story 13.19 — API key guard
import { AuthModule } from './shared/auth/auth.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRoot(getLoggerOptions()),
    CqrsModule.forRoot(),
    PostgresModule,
    RedisModule.forRootAsync({
      isGlobal: true,
      useFactory: defaultRedisConfig,
      inject: [AppConfigService],
    }),
    // VaultModule must precede HealthModule so that VaultSyncService is initialized
    // before VaultSyncHealthIndicator tries to inject it (NestJS initializes
    // modules in import-array order).
    VaultModule,
    HealthModule,
    ApiModule,
    AuthModule,
    EventModule,
    // Shared globals (Story 13.3 stubs — 13.8 / 13.15 retrofit)
    SecretRedactionModule,
    TemporalModule,
    // Shared global — Story 13.7
    GitModule,
    // Shared global — Story 13.10
    AgentsModule,
    // Business modules
    ConversationModule,
    MemoryModule,
    ContextModule,
    DreamModule,
    JarvisConfigModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
