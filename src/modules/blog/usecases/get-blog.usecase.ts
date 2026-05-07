import { Inject, Injectable } from '@nestjs/common';
import { BLOG_REPOSITORY, IBlogRepository } from 'src/shared/domain/repositories/blog.repository.interface';
import { BlogPresenter } from '../models/presenters/blog.presenter';
import { ValidateException } from 'src/shared/common/models/exception/validate.exception';
import { ErrorCode } from 'src/utils/error.code';

@Injectable()
export class GetBlogUseCase {
  constructor(
    @Inject(BLOG_REPOSITORY)
    private readonly blogRepository: IBlogRepository,
  ) {}

  async execute(id: string): Promise<BlogPresenter> {
    const blog = await this.blogRepository.findById(id);
    if (!blog) {
      throw new ValidateException(ErrorCode.BLOG_NOT_FOUND, `Blog ${id} not found`);
    }

    return new BlogPresenter(blog);
  }
}
