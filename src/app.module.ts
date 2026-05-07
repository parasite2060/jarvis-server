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
import { RedisModule } from '@nestjs-redis/kit';

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
    // Business modules
    BlogModule,
    CommentModule,
    AuditLogModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
