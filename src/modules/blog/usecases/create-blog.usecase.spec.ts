import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { EventBus } from '@nestjs/cqrs';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { CreateBlogUseCase } from './create-blog.usecase';
import { IBlogRepository, BLOG_REPOSITORY } from 'src/shared/domain/repositories/blog.repository.interface';
import { Blog } from 'src/shared/domain/entities/blog.entity';
import { CreateBlogRequest } from '../models/requests/create-blog.request';
import { CreateBlogResponse } from '../models/responses/create-blog.response';

describe('CreateBlogUseCase', () => {
  let target: CreateBlogUseCase;
  let mockBlogRepository: DeepMocked<IBlogRepository>;
  let mockEventBus: DeepMocked<EventBus>;

  beforeEach(async () => {
    // Arrange: Create mocks
    mockBlogRepository = createMock<IBlogRepository>();
    mockEventBus = createMock<EventBus>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [CreateBlogUseCase, { provide: BLOG_REPOSITORY, useValue: mockBlogRepository }, { provide: EventBus, useValue: mockEventBus }],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = module.get<CreateBlogUseCase>(CreateBlogUseCase);
  });

  it('should create a blog and publish event', async () => {
    // Arrange
    const request: CreateBlogRequest = {
      title: 'Test Blog',
      content: 'Test Content',
      authorId: 'author-123',
    };
    const expectedBlog = new Blog({
      id: 'blog-123',
      title: 'Test Blog',
      content: 'Test Content',
      authorId: 'author-123',
      isValid: true,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    });
    mockBlogRepository.create.mockResolvedValue(expectedBlog);

    // Act
    const result = await target.execute(request);

    // Assert
    expect(result).toBeInstanceOf(CreateBlogResponse);
    expect(result.id).toBe('blog-123');
    expect(result.title).toBe('Test Blog');
    expect(result.createdAt).toEqual(expectedBlog.createdAt);
    expect(mockBlogRepository.create).toHaveBeenCalledWith({
      title: 'Test Blog',
      content: 'Test Content',
      authorId: 'author-123',
    });
    expect(mockBlogRepository.create).toHaveBeenCalledTimes(1);
    expect(mockEventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'ORG01001',
        payload: expect.objectContaining({
          blogId: 'blog-123',
          title: 'Test Blog',
          authorId: 'author-123',
        }),
      }),
    );
    expect(mockEventBus.publish).toHaveBeenCalledTimes(1);
  });

  it('should propagate error when repository create fails', async () => {
    // Arrange
    const request: CreateBlogRequest = {
      title: 'Test Blog',
      content: 'Test Content',
      authorId: 'author-123',
    };
    const repositoryError = new Error('Database connection failed');
    mockBlogRepository.create.mockRejectedValue(repositoryError);

    // Act & Assert
    await expect(target.execute(request)).rejects.toThrow('Database connection failed');
    expect(mockBlogRepository.create).toHaveBeenCalledWith({
      title: 'Test Blog',
      content: 'Test Content',
      authorId: 'author-123',
    });
    expect(mockBlogRepository.create).toHaveBeenCalledTimes(1);
    expect(mockEventBus.publish).not.toHaveBeenCalled();
  });
});
