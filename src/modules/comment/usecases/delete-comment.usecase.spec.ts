import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { EventBus } from '@nestjs/cqrs';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { DeleteCommentUseCase } from './delete-comment.usecase';
import { ICommentRepository, COMMENT_REPOSITORY } from 'src/shared/domain/repositories/comment.repository.interface';
import { Comment } from 'src/shared/domain/entities/comment.entity';
import { ValidateException } from 'src/shared/common/models/exception/validate.exception';

describe('DeleteCommentUseCase', () => {
  let target: DeleteCommentUseCase;
  let mockCommentRepository: DeepMocked<ICommentRepository>;
  let mockEventBus: DeepMocked<EventBus>;

  beforeEach(async () => {
    // Arrange: Create mocks
    mockCommentRepository = createMock<ICommentRepository>();
    mockEventBus = createMock<EventBus>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeleteCommentUseCase,
        { provide: COMMENT_REPOSITORY, useValue: mockCommentRepository },
        { provide: EventBus, useValue: mockEventBus },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = module.get<DeleteCommentUseCase>(DeleteCommentUseCase);
  });

  it('should soft delete comment and publish event when comment exists', async () => {
    // Arrange
    const commentId = 'comment-123';
    const existingComment = new Comment({
      id: commentId,
      content: 'Test comment content',
      blogId: 'blog-456',
      authorId: 'author-789',
      isValid: true,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    });
    mockCommentRepository.findById.mockResolvedValue(existingComment);
    mockCommentRepository.softDelete.mockResolvedValue(true);

    // Act
    await target.execute(commentId);

    // Assert
    expect(mockCommentRepository.findById).toHaveBeenCalledWith(commentId);
    expect(mockCommentRepository.findById).toHaveBeenCalledTimes(1);
    expect(mockCommentRepository.softDelete).toHaveBeenCalledWith(commentId);
    expect(mockCommentRepository.softDelete).toHaveBeenCalledTimes(1);
    expect(mockEventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'ORG02002',
        payload: expect.objectContaining({
          commentId: 'comment-123',
          blogId: 'blog-456',
        }),
      }),
    );
    expect(mockEventBus.publish).toHaveBeenCalledTimes(1);
  });

  it('should not publish event when soft delete returns false', async () => {
    // Arrange
    const commentId = 'comment-123';
    const existingComment = new Comment({
      id: commentId,
      content: 'Test comment content',
      blogId: 'blog-456',
      authorId: 'author-789',
      isValid: true,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    });
    mockCommentRepository.findById.mockResolvedValue(existingComment);
    mockCommentRepository.softDelete.mockResolvedValue(false);

    // Act
    await target.execute(commentId);

    // Assert
    expect(mockCommentRepository.findById).toHaveBeenCalledWith(commentId);
    expect(mockCommentRepository.softDelete).toHaveBeenCalledWith(commentId);
    expect(mockEventBus.publish).not.toHaveBeenCalled();
  });

  it('should throw ValidateException when comment not found', async () => {
    // Arrange
    const commentId = 'non-existent-id';
    mockCommentRepository.findById.mockResolvedValue(null);

    // Act & Assert
    await expect(target.execute(commentId)).rejects.toThrow(ValidateException);
    expect(mockCommentRepository.findById).toHaveBeenCalledWith(commentId);
    expect(mockCommentRepository.findById).toHaveBeenCalledTimes(1);
    expect(mockCommentRepository.softDelete).not.toHaveBeenCalled();
    expect(mockEventBus.publish).not.toHaveBeenCalled();
  });
});
