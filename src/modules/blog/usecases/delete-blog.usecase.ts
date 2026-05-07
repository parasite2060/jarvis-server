import { Inject, Injectable } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { BLOG_REPOSITORY, IBlogRepository } from 'src/shared/domain/repositories/blog.repository.interface';
import { ValidateException } from 'src/shared/common/models/exception/validate.exception';
import { ErrorCode } from 'src/utils/error.code';
import { BlogDeletedEvent } from '../events/blog-deleted.event';

@Injectable()
export class DeleteBlogUseCase {
  constructor(
    @Inject(BLOG_REPOSITORY)
    private readonly blogRepository: IBlogRepository,
    private readonly eventBus: EventBus,
  ) {}

  async execute(id: string): Promise<void> {
    const existingBlog = await this.blogRepository.findById(id);
    if (!existingBlog) {
      throw new ValidateException(ErrorCode.BLOG_NOT_FOUND, `Blog ${id} not found`);
    }

    const deleted = await this.blogRepository.softDelete(id);

    if (deleted) {
      this.eventBus.publish(new BlogDeletedEvent(existingBlog));
    }
  }
}
