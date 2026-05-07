import { Module } from '@nestjs/common';
import { ConversationController } from './conversation.controller';
import { UseCases } from './usecases';

@Module({
  controllers: [ConversationController],
  providers: [...UseCases],
})
export class ConversationModule {}
