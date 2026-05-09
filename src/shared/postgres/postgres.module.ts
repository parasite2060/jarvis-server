import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { optionsFactory } from './configs';
import { DataSourceLogger } from './datasource.logger';
import { DBConnections } from './utils/constaint';
import { AppConfigService } from '../config/config.service';

// Schemas
import { TranscriptSchema } from './schema/transcript.schema';
import { DreamSchema } from './schema/dream.schema';
import { DreamPhaseSchema } from './schema/dream-phase.schema';
import { FileManifestSchema } from './schema/file-manifest.schema';
import { ContextCacheSchema } from './schema/context-cache.schema';

// Repository implementations
import { ConversationRepositoryImpl } from './repository/conversation.repository.impl';
import { DreamRepositoryImpl } from './repository/dream.repository.impl';
import { DreamPhaseRepositoryImpl } from './repository/dream-phase.repository.impl';
import { FileManifestRepositoryImpl } from './repository/file-manifest.repository.impl';

// Repository tokens
import { CONVERSATION_REPOSITORY } from '../domain/repositories/conversation.repository.interface';
import { DREAM_REPOSITORY } from '../domain/repositories/dream.repository.interface';
import { DREAM_PHASE_REPOSITORY } from '../domain/repositories/dream-phase.repository.interface';
import { FILE_MANIFEST_REPOSITORY } from '../domain/repositories/file-manifest.repository.interface';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      name: DBConnections.INTERNAL,
      useFactory: optionsFactory,
      inject: [AppConfigService],
    }),
    TypeOrmModule.forFeature([TranscriptSchema, DreamSchema, DreamPhaseSchema, FileManifestSchema, ContextCacheSchema], DBConnections.INTERNAL),
  ],
  providers: [
    DataSourceLogger,
    { provide: CONVERSATION_REPOSITORY, useClass: ConversationRepositoryImpl },
    { provide: DREAM_REPOSITORY, useClass: DreamRepositoryImpl },
    { provide: DREAM_PHASE_REPOSITORY, useClass: DreamPhaseRepositoryImpl },
    { provide: FILE_MANIFEST_REPOSITORY, useClass: FileManifestRepositoryImpl },
  ],
  exports: [CONVERSATION_REPOSITORY, DREAM_REPOSITORY, DREAM_PHASE_REPOSITORY, FILE_MANIFEST_REPOSITORY],
})
export class PostgresModule {}
