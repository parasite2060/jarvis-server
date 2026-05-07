import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { GetBlogUseCase } from './get-blog.usecase';
import { IBlogRepository, BLOG_REPOSITORY } from 'src/shared/domain/repositories/blog.repository.interface';
import { Blog } from 'src/shared/domain/entities/blog.entity';
import { BlogPresenter } from '../models/presenters/blog.presenter';
import { ValidateException } from 'src/shared/common/models/exception/validate.exception';
import { ErrorCode } from 'src/utils/error.code';

describe('GetBlogUseCase', () => {
  let target: GetBlogUseCase;
  let mockBlogRepository: DeepMocked<IBlogRepository>;

  beforeEach(async () => {
    // Arrange: Create mocks
    mockBlogRepository = createMock<IBlogRepository>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [GetBlogUseCase, { provide: BLOG_REPOSITORY, useValue: mockBlogRepository }],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = module.get<GetBlogUseCase>(GetBlogUseCase);
  });

  it('should return blog when found', async () => {
    // Arrange
    const blogId = 'blog-123';
    const expectedBlog = new Blog({
      id: blogId,
      title: 'Test Blog',
      content: 'Test Content',
      authorId: 'author-123',
      isValid: true,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    });
    mockBlogRepository.findById.mockResolvedValue(expectedBlog);

    // Act
    const result = await target.execute(blogId);

    // Assert
    expect(result).toBeInstanceOf(BlogPresenter);
    expect(result.id).toEqual(blogId);
    expect(result.title).toBe('Test Blog');
    expect(result.content).toBe('Test Content');
    expect(result.authorId).toBe('author-123');
    expect(result.createdAt).toEqual(expectedBlog.createdAt);
    expect(result.updatedAt).toEqual(expectedBlog.updatedAt);
    expect(mockBlogRepository.findById).toHaveBeenCalledWith(blogId);
    expect(mockBlogRepository.findById).toHaveBeenCalledTimes(1);
  });

  it('should throw ValidateException when blog not found', async () => {
    // Arrange
    const blogId = 'nonexistent-blog';
    mockBlogRepository.findById.mockResolvedValue(null);

    // Act & Assert
    await expect(target.execute(blogId)).rejects.toThrow(ValidateException);
    await expect(target.execute(blogId)).rejects.toMatchObject({
      code: ErrorCode.BLOG_NOT_FOUND,
    });
    expect(mockBlogRepository.findById).toHaveBeenCalledWith(blogId);
  });
});
