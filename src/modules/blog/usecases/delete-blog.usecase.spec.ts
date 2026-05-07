import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { EventBus } from '@nestjs/cqrs';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { DeleteBlogUseCase } from './delete-blog.usecase';
import { IBlogRepository, BLOG_REPOSITORY } from 'src/shared/domain/repositories/blog.repository.interface';
import { Blog } from 'src/shared/domain/entities/blog.entity';
import { ValidateException } from 'src/shared/common/models/exception/validate.exception';
import { ErrorCode } from 'src/utils/error.code';

describe('DeleteBlogUseCase', () => {
  let target: DeleteBlogUseCase;
  let mockBlogRepository: DeepMocked<IBlogRepository>;
  let mockEventBus: DeepMocked<EventBus>;

  beforeEach(async () => {
    // Arrange: Create mocks
    mockBlogRepository = createMock<IBlogRepository>();
    mockEventBus = createMock<EventBus>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [DeleteBlogUseCase, { provide: BLOG_REPOSITORY, useValue: mockBlogRepository }, { provide: EventBus, useValue: mockEventBus }],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = module.get<DeleteBlogUseCase>(DeleteBlogUseCase);
  });

  it('should soft delete a blog and publish event', async () => {
    // Arrange
    const blogId = 'blog-123';
    const existingBlog = new Blog({
      id: blogId,
      title: 'Test Blog',
      content: 'Test Content',
      authorId: 'author-123',
      isValid: true,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    });
    mockBlogRepository.findById.mockResolvedValue(existingBlog);
    mockBlogRepository.softDelete.mockResolvedValue(true);

    // Act
    const result = await target.execute(blogId);

    // Assert
    expect(result).toBeUndefined();
    expect(mockBlogRepository.findById).toHaveBeenCalledWith(blogId);
    expect(mockBlogRepository.softDelete).toHaveBeenCalledWith(blogId);
    expect(mockEventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'ORG01003',
        payload: expect.objectContaining({
          blogId: blogId,
          title: 'Test Blog',
        }),
      }),
    );
    expect(mockEventBus.publish).toHaveBeenCalledTimes(1);
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
  });
});
