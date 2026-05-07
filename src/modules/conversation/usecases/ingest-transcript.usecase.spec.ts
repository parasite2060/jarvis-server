import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { EventBus } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { CONVERSATION_REPOSITORY, IConversationRepository } from 'src/shared/domain/repositories/conversation.repository.interface';
import { SecretScrubberService } from 'src/shared/secret-redaction/secret-scrubber.service';
import { TemporalClientService } from 'src/shared/temporal/temporal-client.service';
import { Conversation } from 'src/shared/domain/entities/conversation.entity';
import { IngestTranscriptUseCase } from './ingest-transcript.usecase';
import { IngestTranscriptRequest } from '../models/requests/ingest-transcript.request';
import { ConversationIngestedEvent } from '../events/conversation-ingested.event';

describe('IngestTranscriptUseCase', () => {
  let target: IngestTranscriptUseCase;
  let mockRepo: DeepMocked<IConversationRepository>;
  let mockScrubber: DeepMocked<SecretScrubberService>;
  let mockTemporal: DeepMocked<TemporalClientService>;
  let mockEventBus: DeepMocked<EventBus>;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  const baseRequest: IngestTranscriptRequest = {
    sessionId: 'sess-1',
    transcript: 'plain transcript body',
    source: 'stop',
    segmentStartLine: 0,
    segmentEndLine: 0,
  };

  function makeRow(overrides: Partial<Conversation> = {}): Conversation {
    return new Conversation({
      id: 100,
      sessionId: 'sess-1',
      source: 'stop',
      rawContent: 'plain transcript body',
      parsedText: 'plain transcript body',
      tokenCount: 6,
      status: 'received',
      isContinuation: false,
      segmentStartLine: 0,
      segmentEndLine: 0,
      lastProcessedLine: 0,
      createdAt: new Date('2026-05-07T00:00:00Z'),
      updatedAt: new Date('2026-05-07T00:00:00Z'),
      ...overrides,
    });
  }

  beforeEach(async () => {
    mockRepo = createMock<IConversationRepository>();
    mockScrubber = createMock<SecretScrubberService>();
    mockTemporal = createMock<TemporalClientService>();
    mockEventBus = createMock<EventBus>();

    // Default: no duplicate, no continuation, no redactions, signal succeeds.
    mockRepo.findRecentBySessionAndSource.mockResolvedValue([]);
    mockRepo.countBySessionId.mockResolvedValue(0);
    mockScrubber.scrub.mockReturnValue({ scrubbed: 'plain transcript body', redactionCounts: {} });
    mockRepo.insertTranscript.mockImplementation(async (input) => makeRow(input));
    mockTemporal.signalCoordinator.mockResolvedValue();
    mockRepo.setStatus.mockResolvedValue();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        IngestTranscriptUseCase,
        { provide: CONVERSATION_REPOSITORY, useValue: mockRepo },
        { provide: SecretScrubberService, useValue: mockScrubber },
        { provide: TemporalClientService, useValue: mockTemporal },
        { provide: EventBus, useValue: mockEventBus },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = moduleRef.get(IngestTranscriptUseCase);
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('happy path — new ingestion, signal succeeds, status updated, event published, returns 202', async () => {
    // Arrange
    mockRepo.insertTranscript.mockResolvedValue(makeRow({ id: 200 }));

    // Act
    const result = await target.execute(baseRequest);

    // Assert
    expect(result.httpStatus).toBe(202);
    expect(result.body.transcriptId).toBe(200);
    expect(result.body.duplicate).toBe(false);
    expect(mockRepo.insertTranscript).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess-1',
        source: 'stop',
        rawContent: 'plain transcript body',
        status: 'received',
        isContinuation: false,
      }),
    );
    expect(mockTemporal.signalCoordinator).toHaveBeenCalledWith('light', {
      transcript_id: 200,
      session_id: 'sess-1',
    });
    expect(mockRepo.setStatus).toHaveBeenCalledWith(200, 'queued');
    expect(mockEventBus.publish).toHaveBeenCalledTimes(1);
    const publishedEvent = mockEventBus.publish.mock.calls[0]![0] as ConversationIngestedEvent;
    expect(publishedEvent).toBeInstanceOf(ConversationIngestedEvent);
    expect(publishedEvent.payload.transcriptId).toBe(200);
    expect(publishedEvent.payload.isContinuation).toBe(false);
  });

  it('duplicate path — returns 200 with existing transcriptId and skips downstream side effects', async () => {
    // Arrange
    mockRepo.findRecentBySessionAndSource.mockResolvedValue([makeRow({ id: 99 })]);

    // Act
    const result = await target.execute(baseRequest);

    // Assert
    expect(result.httpStatus).toBe(200);
    expect(result.body.transcriptId).toBe(99);
    expect(result.body.duplicate).toBe(true);
    expect(mockScrubber.scrub).not.toHaveBeenCalled();
    expect(mockRepo.insertTranscript).not.toHaveBeenCalled();
    expect(mockTemporal.signalCoordinator).not.toHaveBeenCalled();
    expect(mockRepo.setStatus).not.toHaveBeenCalled();
    expect(mockEventBus.publish).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ event: 'conversation.ingest.duplicate', transcriptId: 99 }));
  });

  it('continuation path — countBySessionId > 0 persists is_continuation=true', async () => {
    // Arrange
    mockRepo.countBySessionId.mockResolvedValue(3);
    mockRepo.insertTranscript.mockResolvedValue(makeRow({ id: 300, isContinuation: true }));

    // Act
    await target.execute(baseRequest);

    // Assert
    expect(mockRepo.insertTranscript).toHaveBeenCalledWith(expect.objectContaining({ isContinuation: true }));
  });

  it('signal-success path — repo.setStatus is called and conversation.ingest.queued is logged', async () => {
    // Arrange
    mockRepo.insertTranscript.mockResolvedValue(makeRow({ id: 400 }));

    // Act
    await target.execute(baseRequest);

    // Assert
    expect(mockRepo.setStatus).toHaveBeenCalledWith(400, 'queued');
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ event: 'conversation.ingest.queued', transcriptId: 400 }));
  });

  it('signal-failure path — setStatus NOT called, error logged, use case still returns 202', async () => {
    // Arrange
    mockRepo.insertTranscript.mockResolvedValue(makeRow({ id: 500 }));
    mockTemporal.signalCoordinator.mockRejectedValue(new Error('temporal down'));

    // Act
    const result = await target.execute(baseRequest);

    // Assert
    expect(result.httpStatus).toBe(202);
    expect(result.body.transcriptId).toBe(500);
    expect(mockRepo.setStatus).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'conversation.ingest.temporalSignalFailed',
        transcriptId: 500,
      }),
    );
  });

  it('redaction non-empty path — emits secretScrubber.redactions.completed log with counts only', async () => {
    // Arrange
    mockScrubber.scrub.mockReturnValue({ scrubbed: '[REDACTED]', redactionCounts: { openai_key: 1 } });
    mockRepo.insertTranscript.mockResolvedValue(makeRow({ id: 600 }));

    // Act
    await target.execute(baseRequest);

    // Assert
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'secretScrubber.redactions.completed',
        countsByType: { openai_key: 1 },
      }),
    );
    // Confirm the matched secret content is NOT in the log payload
    const redactionLogCall = logSpy.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>)['event'] === 'secretScrubber.redactions.completed',
    );
    const redactionLogMeta = redactionLogCall![0] as Record<string, unknown>;
    expect(JSON.stringify(redactionLogMeta)).not.toContain('[REDACTED]');
  });

  it('redaction empty path — secretScrubber.redactions.completed log NOT emitted', async () => {
    // Arrange — default mock returns empty redactionCounts
    mockRepo.insertTranscript.mockResolvedValue(makeRow({ id: 700 }));

    // Act
    await target.execute(baseRequest);

    // Assert
    const redactionLogCall = logSpy.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>)['event'] === 'secretScrubber.redactions.completed',
    );
    expect(redactionLogCall).toBeUndefined();
  });
});
