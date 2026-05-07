import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { ListCommentsUseCase } from './list-comments.usecase';
import { ICommentRepository, COMMENT_REPOSITORY } from 'src/shared/domain/repositories/comment.repository.interface';
import { Comment } from 'src/shared/domain/entities/comment.entity';
import { ListCommentsRequest } from '../models/requests/list-comments.request';
import { PaginatedCommentsPresenter } from '../models/presenters/paginated-comments.presenter';
import { ValidateException } from 'src/shared/common/models/exception/validate.exception';

describe('ListCommentsUseCase', () => {
  let target: ListCommentsUseCase;
  let mockCommentRepository: DeepMocked<ICommentRepository>;

  beforeEach(async () => {
    // Arrange: Create mocks
    mockCommentRepository = createMock<ICommentRepository>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [ListCommentsUseCase, { provide: COMMENT_REPOSITORY, useValue: mockCommentRepository }],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = module.get<ListCommentsUseCase>(ListCommentsUseCase);
  });

  it('should return paginated comments presenter for a blog', async () => {
    // Arrange
    const request: ListCommentsRequest = {
      blogId: 'blog-123',
      page: 1,
      limit: 10,
    };
    const mockComments = [
      new Comment({
        id: 'comment-1',
        content: 'First comment',
        blogId: 'blog-123',
        authorId: 'author-1',
        isValid: true,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:00:00Z'),
      }),
      new Comment({
        id: 'comment-2',
        content: 'Second comment',
        blogId: 'blog-123',
        authorId: 'author-2',
        isValid: true,
        createdAt: new Date('2024-01-02T00:00:00Z'),
        updatedAt: new Date('2024-01-02T00:00:00Z'),
      }),
    ];
    mockCommentRepository.findByBlogId.mockResolvedValue({
      items: mockComments,
      total: 2,
    });

    // Act
    const result = await target.execute(request);

    // Assert
    expect(result).toBeInstanceOf(PaginatedCommentsPresenter);
    expect(result.total).toBe(2);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(10);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({
      id: 'comment-1',
      content: 'First comment',
      blogId: 'blog-123',
      authorId: 'author-1',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    });
    expect(result.items[1]).toEqual({
      id: 'comment-2',
      content: 'Second comment',
      blogId: 'blog-123',
      authorId: 'author-2',
      createdAt: new Date('2024-01-02T00:00:00Z'),
      updatedAt: new Date('2024-01-02T00:00:00Z'),
    });
    expect(mockCommentRepository.findByBlogId).toHaveBeenCalledWith('blog-123', { page: 1, limit: 10 });
    expect(mockCommentRepository.findByBlogId).toHaveBeenCalledTimes(1);
  });

  it('should use default pagination when not provided', async () => {
    // Arrange
    const request: ListCommentsRequest = {
      blogId: 'blog-123',
    };
    mockCommentRepository.findByBlogId.mockResolvedValue({
      items: [],
      total: 0,
    });

    // Act
    const result = await target.execute(request);

    // Assert
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(mockCommentRepository.findByBlogId).toHaveBeenCalledWith('blog-123', { page: 1, limit: 20 });
    expect(mockCommentRepository.findByBlogId).toHaveBeenCalledTimes(1);
  });

  it('should throw ValidateException when blogId is not provided', async () => {
    // Arrange
    const request: ListCommentsRequest = {};

    // Act & Assert
    await expect(target.execute(request)).rejects.toThrow(ValidateException);
    expect(mockCommentRepository.findByBlogId).not.toHaveBeenCalled();
  });
});
