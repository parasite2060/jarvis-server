import { Module } from '@nestjs/common';
import { MemoryController } from './memory.controller';
import { UseCases } from './usecases';

@Module({
  controllers: [MemoryController],
  providers: [...UseCases],
})
export class MemoryModule {}
