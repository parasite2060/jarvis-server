import { Inject, Injectable } from '@nestjs/common';
import { BLOG_REPOSITORY, IBlogRepository } from 'src/shared/domain/repositories/blog.repository.interface';
import { ListBlogsRequest } from '../models/requests/list-blogs.request';
import { PaginatedBlogsPresenter } from '../models/presenters/paginated-blogs.presenter';

@Injectable()
export class ListBlogsUseCase {
  constructor(
    @Inject(BLOG_REPOSITORY)
    private readonly blogRepository: IBlogRepository,
  ) {}

  async execute(request: ListBlogsRequest): Promise<PaginatedBlogsPresenter> {
    const page = request.page || 1;
    const limit = request.limit || 20;

    const { items, total } = await this.blogRepository.findAll({ page, limit });

    return new PaginatedBlogsPresenter({
      items,
      total,
      page,
      limit,
    });
  }
}
