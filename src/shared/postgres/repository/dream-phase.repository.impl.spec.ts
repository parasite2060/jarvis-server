import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DreamPhaseRepositoryImpl } from './dream-phase.repository.impl';
import { DreamPhaseSchema } from '../schema/dream-phase.schema';
import { DreamPhase } from 'src/shared/domain/entities/dream-phase.entity';
import { DBConnections } from '../utils/constaint';

describe('DreamPhaseRepositoryImpl', () => {
  let target: DreamPhaseRepositoryImpl;
  let mockRepo: DeepMocked<Repository<DreamPhase>>;

  beforeEach(async () => {
    // Arrange
    mockRepo = createMock<Repository<DreamPhase>>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [DreamPhaseRepositoryImpl, { provide: getRepositoryToken(DreamPhaseSchema, DBConnections.INTERNAL), useValue: mockRepo }],
    }).compile();

    target = module.get(DreamPhaseRepositoryImpl);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('recordPhase', () => {
    it('creates and saves a phase row', async () => {
      // Arrange
      const created = { id: 1, dreamId: 42, phase: 'extraction' } as DreamPhase;
      mockRepo.create.mockReturnValue(created);
      mockRepo.save.mockResolvedValue(created);

      // Act
      const result = await target.recordPhase({ dreamId: 42, phase: 'extraction', status: 'completed' });

      // Assert
      expect(mockRepo.create).toHaveBeenCalledWith({ dreamId: 42, phase: 'extraction', status: 'completed' });
      expect(mockRepo.save).toHaveBeenCalledWith(created);
      expect(result).toEqual(created);
    });
  });

  describe('findByDreamId', () => {
    it('returns rows ordered by createdAt ASC', async () => {
      // Arrange
      const rows: DreamPhase[] = [{ id: 1, dreamId: 42, phase: 'extraction' } as DreamPhase, { id: 2, dreamId: 42, phase: 'record' } as DreamPhase];
      mockRepo.find.mockResolvedValue(rows);

      // Act
      const result = await target.findByDreamId(42);

      // Assert
      expect(mockRepo.find).toHaveBeenCalledWith({ where: { dreamId: 42 }, order: { createdAt: 'ASC' } });
      expect(result).toEqual(rows);
    });
  });

  describe('findRecentPhasesByKind', () => {
    it('filters by phase kind and createdAt cutoff DESC', async () => {
      // Arrange
      const rows: DreamPhase[] = [];
      mockRepo.find.mockResolvedValue(rows);

      // Act
      await target.findRecentPhasesByKind('extraction', '2026-05-01T00:00:00.000Z');

      // Assert
      expect(mockRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ phase: 'extraction' }),
          order: { createdAt: 'DESC' },
        }),
      );
    });
  });
});
