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

  /**
   * Returns the MAX `last_processed_line` across the session — Python
   * `conversations.py:34-41` semantic. Filters out rows where the line is `0`
   * and orders by `last_processed_line DESC`. Returns `0` if no qualifying
   * row exists. Story 13.3 / Q1.d — drift in the Story 13.2 implementation
   * (which ordered by `created_at`) is corrected here per MC1.
   */
  async getLastProcessedLine(sessionId: string): Promise<number> {
    const row = await this.repository
      .createQueryBuilder('t')
      .select('t.lastProcessedLine', 'lastProcessedLine')
      .where('t.sessionId = :sessionId', { sessionId })
      .andWhere('t.lastProcessedLine > 0')
      .orderBy('t.lastProcessedLine', 'DESC')
      .limit(1)
      .getRawOne<{ lastProcessedLine: number | string }>();
    if (!row) return 0;
    const value = typeof row.lastProcessedLine === 'string' ? Number(row.lastProcessedLine) : row.lastProcessedLine;
    return value ?? 0;
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

  async findRecentBySessionAndSource(sessionId: string, source: string, withinMs: number): Promise<Conversation[]> {
    const cutoff = new Date(Date.now() - withinMs);
    return await this.repository.find({
      where: { sessionId, source, createdAt: MoreThanOrEqual(cutoff) },
      order: { createdAt: 'ASC' },
    });
  }

  async countBySessionId(sessionId: string): Promise<number> {
    return await this.repository.count({ where: { sessionId } });
  }

  async setStatus(transcriptId: number, status: string): Promise<void> {
    await this.repository.update({ id: transcriptId }, { status });
  }
}
