/**
 * Unit tests for `MarkDreamOutcomeActivity` (Story 13.10.5 / Q4 decomposition).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { MarkDreamOutcomeActivity } from './mark-dream-outcome.activity';
import { DREAM_REPOSITORY, IDreamRepository } from 'src/shared/domain/repositories/dream.repository.interface';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';

describe('MarkDreamOutcomeActivity', () => {
  let target: MarkDreamOutcomeActivity;
  let mockDreamRepo: DeepMocked<IDreamRepository>;

  beforeEach(async () => {
    mockDreamRepo = createMock<IDreamRepository>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [MarkDreamOutcomeActivity, { provide: DREAM_REPOSITORY, useValue: mockDreamRepo }],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(MarkDreamOutcomeActivity);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('updates dream outcome via dreamRepo', async () => {
    // Arrange
    mockDreamRepo.updateDreamOutcome.mockResolvedValue();

    // Act
    await target.markDreamOutcome({ dream_id: 1, outcome: 'success' });

    // Assert
    expect(mockDreamRepo.updateDreamOutcome).toHaveBeenCalledWith(1, 'success', 'completed');
  });

  it('marks partial outcome on soft-fail path', async () => {
    // Arrange
    mockDreamRepo.updateDreamOutcome.mockResolvedValue();

    // Act
    await target.markDreamOutcome({ dream_id: 2, outcome: 'partial' });

    // Assert
    expect(mockDreamRepo.updateDreamOutcome).toHaveBeenCalledWith(2, 'partial', 'completed');
  });
});
