import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { CommentCreatedHandler } from './comment-created.handler';
import { CreateAuditLogUseCase } from '../../create-audit-log.usecase';
import { DomainEventDto } from '../../../models/requests/domain-event.dto';
import { CommentCreatedPayload } from '../../../models/event-payloads/comment-created.payload';

describe('CommentCreatedHandler', () => {
  let target: CommentCreatedHandler;
  let mockCreateAuditLogUseCase: DeepMocked<CreateAuditLogUseCase>;

  beforeEach(async () => {
    mockCreateAuditLogUseCase = createMock<CreateAuditLogUseCase>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommentCreatedHandler,
        {
          provide: CreateAuditLogUseCase,
          useValue: mockCreateAuditLogUseCase,
        },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = module.get<CommentCreatedHandler>(CommentCreatedHandler);
  });

  it('should call CreateAuditLogUseCase with correct parameters', async () => {
    // Arrange
    const event: DomainEventDto<CommentCreatedPayload> = {
      id: 'evt-123',
      code: 'ORG02001',
      timestamp: new Date('2024-01-01T00:00:00Z'),
      payload: {
        commentId: '550e8400-e29b-41d4-a716-446655440001',
        blogId: '550e8400-e29b-41d4-a716-446655440002',
        content: 'Test comment',
        authorId: '550e8400-e29b-41d4-a716-446655440003',
      },
    };
    mockCreateAuditLogUseCase.execute.mockResolvedValue();

    // Act
    await target.handle(event);

    // Assert
    expect(mockCreateAuditLogUseCase.execute).toHaveBeenCalledWith(event, 'Comment', 'CREATE');
    expect(mockCreateAuditLogUseCase.execute).toHaveBeenCalledTimes(1);
  });

  it('should re-throw use case errors', async () => {
    // Arrange
    const event: DomainEventDto<CommentCreatedPayload> = {
      id: 'evt-123',
      code: 'ORG02001',
      timestamp: new Date('2024-01-01T00:00:00Z'),
      payload: {
        commentId: '550e8400-e29b-41d4-a716-446655440001',
        blogId: '550e8400-e29b-41d4-a716-446655440002',
        content: 'Test comment',
        authorId: '550e8400-e29b-41d4-a716-446655440003',
      },
    };
    mockCreateAuditLogUseCase.execute.mockRejectedValue(new Error('Use case error'));

    // Act & Assert
    await expect(target.handle(event)).rejects.toThrow('Use case error');
    expect(mockCreateAuditLogUseCase.execute).toHaveBeenCalledTimes(1);
  });
});
