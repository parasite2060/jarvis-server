/**
 * Unit tests for `UpdateTranscriptPositionActivity` (Story 13.10.5 / Q4 decomposition).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { UpdateTranscriptPositionActivity } from './update-transcript-position.activity';
import { CONVERSATION_REPOSITORY, IConversationRepository } from 'src/shared/domain/repositories/conversation.repository.interface';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';

describe('UpdateTranscriptPositionActivity', () => {
  let target: UpdateTranscriptPositionActivity;
  let mockConversationRepo: DeepMocked<IConversationRepository>;

  beforeEach(async () => {
    mockConversationRepo = createMock<IConversationRepository>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [UpdateTranscriptPositionActivity, { provide: CONVERSATION_REPOSITORY, useValue: mockConversationRepo }],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(UpdateTranscriptPositionActivity);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('calls conversationRepo.updatePosition with status=processed', async () => {
    // Arrange
    mockConversationRepo.updatePosition.mockResolvedValue();

    // Act
    await target.updateTranscriptPosition({ transcript_id: 5, segment_end_line: 100 });

    // Assert
    expect(mockConversationRepo.updatePosition).toHaveBeenCalledWith(5, 'processed', 100);
  });

  it('throws LIGHT_DREAM_UPDATE_POSITION_FAILED on repo error', async () => {
    // Arrange
    mockConversationRepo.updatePosition.mockRejectedValue(new Error('db'));

    // Act
    const promise = target.updateTranscriptPosition({ transcript_id: 5, segment_end_line: 0 });

    // Assert
    await expect(promise).rejects.toBeInstanceOf(InternalException);
    await expect(promise).rejects.toMatchObject({ code: ErrorCode.LIGHT_DREAM_UPDATE_POSITION_FAILED });
  });
});
