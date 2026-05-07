import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { GetCommentUseCase } from './get-comment.usecase';
import { ICommentRepository, COMMENT_REPOSITORY } from 'src/shared/domain/repositories/comment.repository.interface';
import { Comment } from 'src/shared/domain/entities/comment.entity';
import { CommentPresenter } from '../models/presenters/comment.presenter';
import { ValidateException } from 'src/shared/common/models/exception/validate.exception';

describe('GetCommentUseCase', () => {
  let target: GetCommentUseCase;
  let mockCommentRepository: DeepMocked<ICommentRepository>;

  beforeEach(async () => {
    // Arrange: Create mocks
    mockCommentRepository = createMock<ICommentRepository>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [GetCommentUseCase, { provide: COMMENT_REPOSITORY, useValue: mockCommentRepository }],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = module.get<GetCommentUseCase>(GetCommentUseCase);
  });

  it('should return comment presenter when comment found', async () => {
    // Arrange
    const commentId = 'comment-123';
    const mockComment = new Comment({
      id: commentId,
      content: 'Test comment content',
      blogId: 'blog-456',
      authorId: 'author-789',
      isValid: true,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    });
    mockCommentRepository.findById.mockResolvedValue(mockComment);

    // Act
    const result = await target.execute(commentId);

    // Assert
    expect(result).toBeInstanceOf(CommentPresenter);
    expect(result).toEqual({
      id: 'comment-123',
      content: 'Test comment content',
      blogId: 'blog-456',
      authorId: 'author-789',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    });
    expect(mockCommentRepository.findById).toHaveBeenCalledWith(commentId);
    expect(mockCommentRepository.findById).toHaveBeenCalledTimes(1);
  });

  it('should throw ValidateException when comment not found', async () => {
    // Arrange
    const commentId = 'non-existent-id';
    mockCommentRepository.findById.mockResolvedValue(null);

    // Act & Assert
    await expect(target.execute(commentId)).rejects.toThrow(ValidateException);
    expect(mockCommentRepository.findById).toHaveBeenCalledWith(commentId);
    expect(mockCommentRepository.findById).toHaveBeenCalledTimes(1);
  });
});
