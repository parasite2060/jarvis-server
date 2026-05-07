import { Dream } from '../entities/dream.entity';

export const DREAM_REPOSITORY = Symbol('DREAM_REPOSITORY');

export interface IDreamRepository {
  createDream(input: Partial<Dream>): Promise<Dream>;
  updateDreamOutcome(id: number, outcome: string, status?: string): Promise<void>;
  persistSessionLog(id: number, sessionLog: Record<string, unknown>): Promise<void>;
  findByDate(date: string): Promise<Dream[]>;
  findById(id: number): Promise<Dream | null>;
}
