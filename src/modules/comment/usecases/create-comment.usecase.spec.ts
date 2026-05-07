import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { EventBus } from '@nestjs/cqrs';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { CreateCommentUseCase } from './create-comment.usecase';
import { ICommentRepository, COMMENT_REPOSITORY } from 'src/shared/domain/repositories/comment.repository.interface';
import { IBlogRepository, BLOG_REPOSITORY } from 'src/shared/domain/repositories/blog.repository.interface';
import { Comment } from 'src/shared/domain/entities/comment.entity';
import { Blog } from 'src/shared/domain/entities/blog.entity';
import { CreateCommentRequest } from '../models/requests/create-comment.request';
import { CreateCommentResponse } from '../models/responses/create-comment.response';
import { ValidateException } from 'src/shared/common/models/exception/validate.exception';

describe('CreateCommentUseCase', () => {
  let target: CreateCommentUseCase;
  let mockCommentRepository: DeepMocked<ICommentRepository>;
  let mockBlogRepository: DeepMocked<IBlogRepository>;
  let mockEventBus: DeepMocked<EventBus>;

  beforeEach(async () => {
    // Arrange: Create mocks
    mockCommentRepository = createMock<ICommentRepository>();
    mockBlogRepository = createMock<IBlogRepository>();
    mockEventBus = createMock<EventBus>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreateCommentUseCase,
        { provide: COMMENT_REPOSITORY, useValue: mockCommentRepository },
        { provide: BLOG_REPOSITORY, useValue: mockBlogRepository },
        { provide: EventBus, useValue: mockEventBus },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = module.get<CreateCommentUseCase>(CreateCommentUseCase);
  });

  it('should create a comment and publish event when blog exists', async () => {
    // Arrange
    const request: CreateCommentRequest = {
      content: 'Test comment content',
      blogId: 'blog-123',
      authorId: 'author-456',
    };
    const mockBlog = new Blog({
      id: 'blog-123',
      title: 'Test Blog',
      content: 'Blog content',
      authorId: 'blog-author',
      isValid: true,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    });
    const expectedComment = new Comment({
      id: 'comment-789',
      content: 'Test comment content',
      blogId: 'blog-123',
      authorId: 'author-456',
      isValid: true,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    });

    mockBlogRepository.findById.mockResolvedValue(mockBlog);
    mockCommentRepository.create.mockResolvedValue(expectedComment);

    // Act
    const result = await target.execute(request);

    // Assert
    expect(result).toBeInstanceOf(CreateCommentResponse);
    expect(result.id).toBe('comment-789');
    expect(result.blogId).toBe('blog-123');
    expect(result.createdAt).toEqual(expectedComment.createdAt);
    expect(mockBlogRepository.findById).toHaveBeenCalledWith('blog-123');
    expect(mockBlogRepository.findById).toHaveBeenCalledTimes(1);
    expect(mockCommentRepository.create).toHaveBeenCalledWith({
      content: 'Test comment content',
      blogId: 'blog-123',
      authorId: 'author-456',
    });
    expect(mockCommentRepository.create).toHaveBeenCalledTimes(1);
    expect(mockEventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'ORG02001',
        payload: expect.objectContaining({
          commentId: 'comment-789',
          blogId: 'blog-123',
          authorId: 'author-456',
        }),
      }),
    );
    expect(mockEventBus.publish).toHaveBeenCalledTimes(1);
  });

  it('should throw ValidateException when blog not found', async () => {
    // Arrange
    const request: CreateCommentRequest = {
      content: 'Test comment content',
      blogId: 'non-existent-blog',
      authorId: 'author-456',
    };
    mockBlogRepository.findById.mockResolvedValue(null);

    // Act & Assert
    await expect(target.execute(request)).rejects.toThrow(ValidateException);
    expect(mockBlogRepository.findById).toHaveBeenCalledWith('non-existent-blog');
    expect(mockBlogRepository.findById).toHaveBeenCalledTimes(1);
    expect(mockCommentRepository.create).not.toHaveBeenCalled();
    expect(mockEventBus.publish).not.toHaveBeenCalled();
  });
});
