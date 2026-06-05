/**
 * Unit tests for `MarkDeepDreamOutcomeActivity` (Story 13.10.5 / Q4 decomposition).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { MarkDeepDreamOutcomeActivity } from './mark-deep-dream-outcome.activity';
import { DREAM_REPOSITORY, IDreamRepository } from 'src/shared/domain/repositories/dream.repository.interface';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';

describe('MarkDeepDreamOutcomeActivity', () => {
  let target: MarkDeepDreamOutcomeActivity;
  let mockDreamRepo: DeepMocked<IDreamRepository>;

  beforeEach(async () => {
    mockDreamRepo = createMock<IDreamRepository>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [MarkDeepDreamOutcomeActivity, { provide: DREAM_REPOSITORY, useValue: mockDreamRepo }],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(MarkDeepDreamOutcomeActivity);
  });

  it('updates the dream row with outcome and status=completed', async () => {
    // Arrange / Act
    await target.markDeepDreamOutcome({ dream_id: 7, outcome: 'completed' });

    // Assert
    expect(mockDreamRepo.updateDreamOutcome).toHaveBeenCalledWith(7, 'completed', 'completed');
  });

  it("supports outcome='skipped'", async () => {
    await target.markDeepDreamOutcome({ dream_id: 8, outcome: 'skipped' });
    expect(mockDreamRepo.updateDreamOutcome).toHaveBeenCalledWith(8, 'skipped', 'completed');
  });

  it("supports outcome='partial'", async () => {
    await target.markDeepDreamOutcome({ dream_id: 9, outcome: 'partial' });
    expect(mockDreamRepo.updateDreamOutcome).toHaveBeenCalledWith(9, 'partial', 'completed');
  });
});
