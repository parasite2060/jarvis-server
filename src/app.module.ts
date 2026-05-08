/* istanbul ignore file */
import { Module } from '@nestjs/common';
import { ApiModule } from './shared/api/api.module';
import { HealthModule } from './shared/health/health.module';
import { getLoggerOptions } from './utils/config/logger.config';
import { LoggerModule } from './shared/logger/logger.module';
import { defaultRedisConfig } from './utils/config/redis.config';
import { CqrsModule } from '@nestjs/cqrs';
import { EventModule } from './shared/event/event.module';
import { MongoDBModule } from './shared/mongo/mongo.module';
import { PostgresModule } from './shared/postgres/postgres.module';
import { AppConfigModule } from './shared/config/config.module';
import { AppConfigService } from './shared/config/config.service';

// Business modules
import { BlogModule } from './modules/blog/blog.module';
import { CommentModule } from './modules/comment/comment.module';
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { ConversationModule } from './modules/conversation/conversation.module';
import { ContextModule } from './modules/context/context.module';
import { DreamModule } from './modules/dream/dream.module';
import { MemoryModule } from './modules/memory/memory.module';
import { VaultModule } from './modules/vault/vault.module';
// Story 13.10.5 — config business module per module-map §1 lines 170-180.
// Distinct from `src/shared/config/` (boilerplate env-var loader; different scope).
import { ConfigModule as JarvisConfigModule } from './modules/config/config.module';
import { RedisModule } from '@nestjs-redis/kit';

// Shared (global) modules — Story 13.3 stubs
import { SecretRedactionModule } from './shared/secret-redaction/secret-redaction.module';
import { TemporalModule } from './shared/temporal/temporal.module';
// Shared (global) module — Story 13.7
import { GitModule } from './shared/git/git.module';
// Shared (global) module — Story 13.10
import { AgentsModule } from './shared/agents/agents.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRoot(getLoggerOptions()),
    CqrsModule.forRoot(),
    MongoDBModule,
    PostgresModule,
    RedisModule.forRootAsync({
      isGlobal: true,
      useFactory: defaultRedisConfig,
      inject: [AppConfigService],
    }),
    HealthModule,
    ApiModule,
    EventModule,
    // Shared globals (Story 13.3 stubs — 13.8 / 13.15 retrofit)
    SecretRedactionModule,
    TemporalModule,
    // Shared global — Story 13.7
    GitModule,
    // Shared global — Story 13.10
    AgentsModule,
    // Business modules
    BlogModule,
    CommentModule,
    AuditLogModule,
    ConversationModule,
    MemoryModule,
    VaultModule,
    ContextModule,
    DreamModule,
    JarvisConfigModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
