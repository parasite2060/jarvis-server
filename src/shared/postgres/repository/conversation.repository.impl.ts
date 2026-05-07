import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { Conversation } from 'src/shared/domain/entities/conversation.entity';
import { IConversationRepository } from 'src/shared/domain/repositories/conversation.repository.interface';
import { TranscriptSchema } from '../schema/transcript.schema';
import { DBConnections } from '../utils/constaint';

@Injectable()
export class ConversationRepositoryImpl implements IConversationRepository {
  constructor(
    @InjectRepository(TranscriptSchema, DBConnections.INTERNAL)
    private readonly repository: Repository<Conversation>,
  ) {}

  async insertTranscript(input: Partial<Conversation>): Promise<Conversation> {
    const entity = this.repository.create(input);
    return await this.repository.save(entity);
  }

  async findBySessionId(sessionId: string): Promise<Conversation[]> {
    return await this.repository.find({
      where: { sessionId },
      order: { createdAt: 'ASC' },
    });
  }

  async getLastProcessedLine(sessionId: string): Promise<number> {
    const latest = await this.repository.findOne({
      where: { sessionId },
      order: { createdAt: 'DESC' },
    });
    return latest?.lastProcessedLine ?? 0;
  }

  async setLastProcessedLine(sessionId: string, line: number): Promise<void> {
    await this.repository.update({ sessionId }, { lastProcessedLine: line });
  }

  async findRecentBySession(sessionId: string, withinMs: number): Promise<Conversation[]> {
    const cutoff = new Date(Date.now() - withinMs);
    return await this.repository.find({
      where: { sessionId, createdAt: MoreThanOrEqual(cutoff) },
      order: { createdAt: 'ASC' },
    });
  }
}
