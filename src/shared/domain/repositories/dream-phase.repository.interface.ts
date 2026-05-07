import { DreamPhase } from '../entities/dream-phase.entity';

export const DREAM_PHASE_REPOSITORY = Symbol('DREAM_PHASE_REPOSITORY');

/**
 * Story 13.2 ships the interface only — no implementation. The concrete repo
 * lands in Story 13.10/13.11 (deep-dream phase persistence).
 */
export interface IDreamPhaseRepository {
  recordPhase(input: Partial<DreamPhase>): Promise<DreamPhase>;
  findByDreamId(dreamId: number): Promise<DreamPhase[]>;
  findRecentPhasesByKind(phase: string, sinceIso: string): Promise<DreamPhase[]>;
}
