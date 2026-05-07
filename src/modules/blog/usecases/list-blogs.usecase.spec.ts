import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { ListBlogsUseCase } from './list-blogs.usecase';
import { IBlogRepository, BLOG_REPOSITORY } from 'src/shared/domain/repositories/blog.repository.interface';
import { Blog } from 'src/shared/domain/entities/blog.entity';
import { ListBlogsRequest } from '../models/requests/list-blogs.request';
import { PaginatedBlogsPresenter } from '../models/presenters/paginated-blogs.presenter';

describe('ListBlogsUseCase', () => {
  let target: ListBlogsUseCase;
  let mockBlogRepository: DeepMocked<IBlogRepository>;

  beforeEach(async () => {
    // Arrange: Create mocks
    mockBlogRepository = createMock<IBlogRepository>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [ListBlogsUseCase, { provide: BLOG_REPOSITORY, useValue: mockBlogRepository }],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = module.get<ListBlogsUseCase>(ListBlogsUseCase);
  });

  it('should return paginated blogs', async () => {
    // Arrange
    const request: ListBlogsRequest = { page: 1, limit: 10 };
    const blogs = [
      new Blog({
        id: 'blog-1',
        title: 'Blog 1',
        content: 'Content 1',
        authorId: 'author-1',
        isValid: true,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:00:00Z'),
      }),
      new Blog({
        id: 'blog-2',
        title: 'Blog 2',
        content: 'Content 2',
        authorId: 'author-2',
        isValid: true,
        createdAt: new Date('2024-01-02T00:00:00Z'),
        updatedAt: new Date('2024-01-02T00:00:00Z'),
      }),
    ];
    mockBlogRepository.findAll.mockResolvedValue({ items: blogs, total: 25 });

    // Act
    const result = await target.execute(request);

    // Assert
    expect(result).toBeInstanceOf(PaginatedBlogsPresenter);
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(25);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(10);
    expect(result.items[0]!.id).toBe('blog-1');
    expect(result.items[0]!.title).toBe('Blog 1');
    expect(result.items[0]!.content).toBe('Content 1');
    expect(result.items[0]!.authorId).toBe('author-1');
    expect(mockBlogRepository.findAll).toHaveBeenCalledWith({ page: 1, limit: 10 });
    expect(mockBlogRepository.findAll).toHaveBeenCalledTimes(1);
  });

  it('should use default pagination when not provided', async () => {
    // Arrange
    const request: ListBlogsRequest = {};
    mockBlogRepository.findAll.mockResolvedValue({ items: [], total: 0 });

    // Act
    const result = await target.execute(request);

    // Assert
    expect(result).toBeInstanceOf(PaginatedBlogsPresenter);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(mockBlogRepository.findAll).toHaveBeenCalledWith({ page: 1, limit: 20 });
  });

  it('should return empty list when no blogs exist', async () => {
    // Arrange
    const request: ListBlogsRequest = { page: 1, limit: 10 };
    mockBlogRepository.findAll.mockResolvedValue({ items: [], total: 0 });

    // Act
    const result = await target.execute(request);

    // Assert
    expect(result).toBeInstanceOf(PaginatedBlogsPresenter);
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(10);
    expect(mockBlogRepository.findAll).toHaveBeenCalledWith({ page: 1, limit: 10 });
    expect(mockBlogRepository.findAll).toHaveBeenCalledTimes(1);
  });
});
