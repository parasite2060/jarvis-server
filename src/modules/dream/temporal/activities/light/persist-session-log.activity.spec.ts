/**
 * Unit tests for `PersistSessionLogActivity` (Story 13.10.5 / Q4 decomposition).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { PersistSessionLogActivity } from './persist-session-log.activity';
import { DREAM_REPOSITORY, IDreamRepository } from 'src/shared/domain/repositories/dream.repository.interface';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import { emptySessionLog } from '../../../agents/extraction-summary.schema';

describe('PersistSessionLogActivity', () => {
  let target: PersistSessionLogActivity;
  let mockDreamRepo: DeepMocked<IDreamRepository>;

  beforeEach(async () => {
    mockDreamRepo = createMock<IDreamRepository>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [PersistSessionLogActivity, { provide: DREAM_REPOSITORY, useValue: mockDreamRepo }],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(PersistSessionLogActivity);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('delegates to dreamRepo.persistSessionLog', async () => {
    // Arrange
    mockDreamRepo.persistSessionLog.mockResolvedValue();

    // Act
    await target.persistSessionLog({ dream_id: 1, session_log_json: emptySessionLog() });

    // Assert
    expect(mockDreamRepo.persistSessionLog).toHaveBeenCalledWith(1, expect.any(Object));
  });

  it('throws LIGHT_DREAM_PERSIST_SESSION_LOG_FAILED on repo error', async () => {
    // Arrange
    mockDreamRepo.persistSessionLog.mockRejectedValue(new Error('db down'));

    // Act
    const promise = target.persistSessionLog({ dream_id: 1, session_log_json: emptySessionLog() });

    // Assert
    await expect(promise).rejects.toBeInstanceOf(InternalException);
    await expect(promise).rejects.toMatchObject({ code: ErrorCode.LIGHT_DREAM_PERSIST_SESSION_LOG_FAILED });
  });
});
