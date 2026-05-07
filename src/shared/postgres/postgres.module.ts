import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { optionsFactory } from './configs';
import { DataSourceLogger } from './datasource.logger';
import { DBConnections } from './utils/constaint';
import { AppConfigService } from '../config/config.service';

// Schemas
import { BlogSchema } from './schema/blog.schema';
import { CommentSchema } from './schema/comment.schema';
import { TranscriptSchema } from './schema/transcript.schema';
import { DreamSchema } from './schema/dream.schema';
import { DreamPhaseSchema } from './schema/dream-phase.schema';
import { FileManifestSchema } from './schema/file-manifest.schema';
import { ContextCacheSchema } from './schema/context-cache.schema';

// Repository implementations
import { BlogRepositoryImpl } from './repository/blog.repository.impl';
import { CommentRepositoryImpl } from './repository/comment.repository.impl';
import { ConversationRepositoryImpl } from './repository/conversation.repository.impl';
import { DreamRepositoryImpl } from './repository/dream.repository.impl';

// Repository tokens
import { BLOG_REPOSITORY } from '../domain/repositories/blog.repository.interface';
import { COMMENT_REPOSITORY } from '../domain/repositories/comment.repository.interface';
import { CONVERSATION_REPOSITORY } from '../domain/repositories/conversation.repository.interface';
import { DREAM_REPOSITORY } from '../domain/repositories/dream.repository.interface';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      name: DBConnections.INTERNAL,
      useFactory: optionsFactory,
      inject: [AppConfigService],
    }),
    TypeOrmModule.forFeature(
      [BlogSchema, CommentSchema, TranscriptSchema, DreamSchema, DreamPhaseSchema, FileManifestSchema, ContextCacheSchema],
      DBConnections.INTERNAL,
    ),
  ],
  providers: [
    DataSourceLogger,
    { provide: BLOG_REPOSITORY, useClass: BlogRepositoryImpl },
    { provide: COMMENT_REPOSITORY, useClass: CommentRepositoryImpl },
    { provide: CONVERSATION_REPOSITORY, useClass: ConversationRepositoryImpl },
    { provide: DREAM_REPOSITORY, useClass: DreamRepositoryImpl },
  ],
  exports: [BLOG_REPOSITORY, COMMENT_REPOSITORY, CONVERSATION_REPOSITORY, DREAM_REPOSITORY],
})
export class PostgresModule {}
