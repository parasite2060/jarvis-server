import { Dream } from '../entities/dream.entity';

export const DREAM_REPOSITORY = Symbol('DREAM_REPOSITORY');

export interface IDreamRepository {
  createDream(input: Partial<Dream>): Promise<Dream>;
  updateDreamOutcome(id: number, outcome: string, status?: string): Promise<void>;
  persistSessionLog(id: number, sessionLog: Record<string, unknown>): Promise<void>;
  findByDate(date: string): Promise<Dream[]>;
  findById(id: number): Promise<Dream | null>;
  // Story 13.5 / Q9 — used by `getLatestHealthReport()` to surface the latest
  // deep-dream's `output_raw` health-summary regex match. Returns null when no
  // completed deep dream exists. Mirrors Python `context_assembly.py:42-49`
  // SELECT ... WHERE type='deep' AND status='completed' ORDER BY completed_at DESC LIMIT 1.
  findLatestCompletedDeep(): Promise<Dream | null>;
}
