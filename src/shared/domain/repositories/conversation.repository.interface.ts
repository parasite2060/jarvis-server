import { Conversation } from '../entities/conversation.entity';

export const CONVERSATION_REPOSITORY = Symbol('CONVERSATION_REPOSITORY');

export interface IConversationRepository {
  insertTranscript(input: Partial<Conversation>): Promise<Conversation>;
  findBySessionId(sessionId: string): Promise<Conversation[]>;
  getLastProcessedLine(sessionId: string): Promise<number>;
  setLastProcessedLine(sessionId: string, line: number): Promise<void>;
  findRecentBySession(sessionId: string, withinMs: number): Promise<Conversation[]>;
}
