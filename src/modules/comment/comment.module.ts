import { Module } from '@nestjs/common';
import { CommentController } from './comment.controller';
import { UseCases } from './usecases';

@Module({
  controllers: [CommentController],
  providers: [...UseCases],
})
export class CommentModule {}
