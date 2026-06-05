/**
 * Unit tests for `MarkWeeklyReviewOutcomeActivity` (Story 13.10.5 / Q4 decomposition).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { MarkWeeklyReviewOutcomeActivity } from './mark-weekly-review-outcome.activity';
import { DREAM_REPOSITORY, IDreamRepository } from 'src/shared/domain/repositories/dream.repository.interface';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { ErrorCode } from 'src/utils/error.code';

describe('MarkWeeklyReviewOutcomeActivity', () => {
  let target: MarkWeeklyReviewOutcomeActivity;
  let mockDreamRepo: DeepMocked<IDreamRepository>;

  beforeEach(async () => {
    mockDreamRepo = createMock<IDreamRepository>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [MarkWeeklyReviewOutcomeActivity, { provide: DREAM_REPOSITORY, useValue: mockDreamRepo }],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(MarkWeeklyReviewOutcomeActivity);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("delegates to dreamRepo.updateDreamOutcome with status='completed'", async () => {
    // Act
    await target.markWeeklyReviewOutcome({ dream_id: 30, outcome: 'completed' });

    // Assert
    expect(mockDreamRepo.updateDreamOutcome).toHaveBeenCalledWith(30, 'completed', 'completed');
  });

  it('throws WEEKLY_REVIEW_OUTCOME_UPDATE_FAILED on repo error', async () => {
    // Arrange
    mockDreamRepo.updateDreamOutcome.mockRejectedValue(new Error('db down'));

    // Act
    const promise = target.markWeeklyReviewOutcome({ dream_id: 31, outcome: 'partial' });

    // Assert
    await expect(promise).rejects.toMatchObject({ code: ErrorCode.WEEKLY_REVIEW_OUTCOME_UPDATE_FAILED });
  });
});
