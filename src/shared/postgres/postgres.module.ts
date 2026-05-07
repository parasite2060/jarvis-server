import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { optionsFactory } from './configs';
import { DataSourceLogger } from './datasource.logger';
import { DBConnections } from './utils/constaint';
import { AppConfigService } from '../config/config.service';

// Schemas
import { BlogSchema } from './schema/blog.schema';
import { CommentSchema } from './schema/comment.schema';

// Repository implementations
import { BlogRepositoryImpl } from './repository/blog.repository.impl';
import { CommentRepositoryImpl } from './repository/comment.repository.impl';

// Repository tokens
import { BLOG_REPOSITORY } from '../domain/repositories/blog.repository.interface';
import { COMMENT_REPOSITORY } from '../domain/repositories/comment.repository.interface';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      name: DBConnections.INTERNAL,
      useFactory: optionsFactory,
      inject: [AppConfigService],
    }),
    TypeOrmModule.forFeature([BlogSchema, CommentSchema], DBConnections.INTERNAL),
  ],
  providers: [
    DataSourceLogger,
    { provide: BLOG_REPOSITORY, useClass: BlogRepositoryImpl },
    { provide: COMMENT_REPOSITORY, useClass: CommentRepositoryImpl },
  ],
  exports: [BLOG_REPOSITORY, COMMENT_REPOSITORY],
})
export class PostgresModule {}
