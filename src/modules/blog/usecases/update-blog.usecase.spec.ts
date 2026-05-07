import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { EventBus } from '@nestjs/cqrs';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { UpdateBlogUseCase } from './update-blog.usecase';
import { IBlogRepository, BLOG_REPOSITORY } from 'src/shared/domain/repositories/blog.repository.interface';
import { Blog } from 'src/shared/domain/entities/blog.entity';
import { UpdateBlogRequest } from '../models/requests/update-blog.request';
import { UpdateBlogResponse } from '../models/responses/update-blog.response';
import { ValidateException } from 'src/shared/common/models/exception/validate.exception';
import { ErrorCode } from 'src/utils/error.code';

describe('UpdateBlogUseCase', () => {
  let target: UpdateBlogUseCase;
  let mockBlogRepository: DeepMocked<IBlogRepository>;
  let mockEventBus: DeepMocked<EventBus>;

  beforeEach(async () => {
    // Arrange: Create mocks
    mockBlogRepository = createMock<IBlogRepository>();
    mockEventBus = createMock<EventBus>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [UpdateBlogUseCase, { provide: BLOG_REPOSITORY, useValue: mockBlogRepository }, { provide: EventBus, useValue: mockEventBus }],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = module.get<UpdateBlogUseCase>(UpdateBlogUseCase);
  });

  it('should update a blog and publish event', async () => {
    // Arrange
    const blogId = 'blog-123';
    const request: UpdateBlogRequest = {
      title: 'Updated Title',
      content: 'Updated Content',
    };
    const existingBlog = new Blog({
      id: blogId,
      title: 'Old Title',
      content: 'Old Content',
      authorId: 'author-123',
      isValid: true,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    });
    const updatedBlog = new Blog({
      id: blogId,
      title: 'Updated Title',
      content: 'Updated Content',
      authorId: 'author-123',
      isValid: true,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-02T00:00:00Z'),
    });
    mockBlogRepository.findById.mockResolvedValue(existingBlog);
    mockBlogRepository.update.mockResolvedValue(updatedBlog);

    // Act
    const result = await target.execute(blogId, request);

    // Assert
    expect(result).toBeInstanceOf(UpdateBlogResponse);
    expect(result.id).toEqual(blogId);
    expect(result.title).toBe('Updated Title');
    expect(result.updatedAt).toEqual(updatedBlog.updatedAt);
    expect(mockBlogRepository.findById).toHaveBeenCalledWith(blogId);
    expect(mockBlogRepository.update).toHaveBeenCalledWith(blogId, {
      title: 'Updated Title',
      content: 'Updated Content',
    });
    expect(mockEventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'ORG01002',
        payload: expect.objectContaining({
          blogId: blogId,
          title: 'Updated Title',
        }),
      }),
    );
  });

  it('should throw ValidateException when blog not found', async () => {
    // Arrange
    const blogId = 'nonexistent-blog';
    const request: UpdateBlogRequest = { title: 'Updated Title' };
    mockBlogRepository.findById.mockResolvedValue(null);

    // Act & Assert
    await expect(target.execute(blogId, request)).rejects.toThrow(ValidateException);
    await expect(target.execute(blogId, request)).rejects.toMatchObject({
      code: ErrorCode.BLOG_NOT_FOUND,
    });
    expect(mockBlogRepository.update).not.toHaveBeenCalled();
    expect(mockEventBus.publish).not.toHaveBeenCalled();
  });

  it('should throw ValidateException when update returns null', async () => {
    // Arrange
    const blogId = 'blog-123';
    const request: UpdateBlogRequest = {
      title: 'Updated Title',
      content: 'Updated Content',
    };
    const existingBlog = new Blog({
      id: blogId,
      title: 'Old Title',
      content: 'Old Content',
      authorId: 'author-123',
      isValid: true,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    });
    mockBlogRepository.findById.mockResolvedValue(existingBlog);
    mockBlogRepository.update.mockResolvedValue(null);

    // Act & Assert
    await expect(target.execute(blogId, request)).rejects.toThrow(ValidateException);
    await expect(target.execute(blogId, request)).rejects.toMatchObject({
      code: ErrorCode.BLOG_NOT_FOUND,
    });
    expect(mockBlogRepository.findById).toHaveBeenCalledWith(blogId);
    expect(mockBlogRepository.update).toHaveBeenCalledWith(blogId, {
      title: 'Updated Title',
      content: 'Updated Content',
    });
    expect(mockEventBus.publish).not.toHaveBeenCalled();
  });
});
