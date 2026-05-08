/**
 * `IDreamPhaseRepository` implementation (Story 13.10 — deferred from 13.2).
 *
 * Story 13.2 line 36-37 + 179 explicitly deferred this implementation to the
 * first dream-pipeline story (13.10). The repository persists per-phase
 * telemetry rows on `jarvis.dream_phases` for every agent run (extraction
 * + record for light, P1 + P2 + P3 for deep, weekly for review).
 *
 * Mirrors Python `app/services/dream_telemetry.py::store_phase_telemetry`.
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { DreamPhase } from 'src/shared/domain/entities/dream-phase.entity';
import { IDreamPhaseRepository } from 'src/shared/domain/repositories/dream-phase.repository.interface';
import { DreamPhaseSchema } from '../schema/dream-phase.schema';
import { DBConnections } from '../utils/constaint';

@Injectable()
export class DreamPhaseRepositoryImpl implements IDreamPhaseRepository {
  constructor(
    @InjectRepository(DreamPhaseSchema, DBConnections.INTERNAL)
    private readonly repository: Repository<DreamPhase>,
  ) {}

  async recordPhase(input: Partial<DreamPhase>): Promise<DreamPhase> {
    const entity = this.repository.create(input);
    return await this.repository.save(entity);
  }

  async findByDreamId(dreamId: number): Promise<DreamPhase[]> {
    return await this.repository.find({
      where: { dreamId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Mirrors Python's "find recent phases of a given kind for cross-dream
   * trend queries" — used by deep-dream's Phase 1 scoring (Story 13.11) to
   * compute reinforcement frequency. Returns rows where `phase = $1` AND
   * `created_at >= $2`.
   */
  async findRecentPhasesByKind(phase: string, sinceIso: string): Promise<DreamPhase[]> {
    const since = new Date(sinceIso);
    return await this.repository.find({
      where: { phase, createdAt: MoreThanOrEqual(since) },
      order: { createdAt: 'DESC' },
    });
  }
}
