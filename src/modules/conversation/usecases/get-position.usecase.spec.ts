import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { CONVERSATION_REPOSITORY, IConversationRepository } from 'src/shared/domain/repositories/conversation.repository.interface';
import { GetPositionUseCase } from './get-position.usecase';
import { GetPositionRequest } from '../models/requests/get-position.request';

describe('GetPositionUseCase', () => {
  let target: GetPositionUseCase;
  let mockRepo: DeepMocked<IConversationRepository>;

  beforeEach(async () => {
    mockRepo = createMock<IConversationRepository>();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [GetPositionUseCase, { provide: CONVERSATION_REPOSITORY, useValue: mockRepo }],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = moduleRef.get(GetPositionUseCase);
  });

  it('should return the value when the repo finds last_processed_line > 0', async () => {
    // Arrange
    const request = new GetPositionRequest();
    request.sessionId = 'sess-A';
    mockRepo.getLastProcessedLine.mockResolvedValue(250);

    // Act
    const result = await target.execute(request);

    // Assert
    expect(result.session_id).toBe('sess-A');
    expect(result.last_line).toBe(250);
    expect(mockRepo.getLastProcessedLine).toHaveBeenCalledWith('sess-A');
  });

  it('should return 0 when the repo signals no qualifying row (returns 0)', async () => {
    // Arrange
    const request = new GetPositionRequest();
    request.sessionId = 'sess-B';
    mockRepo.getLastProcessedLine.mockResolvedValue(0);

    // Act
    const result = await target.execute(request);

    // Assert
    expect(result.session_id).toBe('sess-B');
    expect(result.last_line).toBe(0);
  });

  it('should never throw — even when no transcripts exist for the session', async () => {
    // Arrange
    const request = new GetPositionRequest();
    request.sessionId = 'sess-missing';
    mockRepo.getLastProcessedLine.mockResolvedValue(0);

    // Act / Assert
    await expect(target.execute(request)).resolves.toEqual({
      session_id: 'sess-missing',
      last_line: 0,
    });
  });
});
