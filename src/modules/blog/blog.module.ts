import { Module } from '@nestjs/common';
import { BlogController } from './blog.controller';
import { UseCases } from './usecases';

@Module({
  controllers: [BlogController],
  providers: [...UseCases],
})
export class BlogModule {}
