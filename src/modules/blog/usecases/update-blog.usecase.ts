import { Inject, Injectable } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { BLOG_REPOSITORY, IBlogRepository } from 'src/shared/domain/repositories/blog.repository.interface';
import { UpdateBlogRequest } from '../models/requests/update-blog.request';
import { UpdateBlogResponse } from '../models/responses/update-blog.response';
import { ValidateException } from 'src/shared/common/models/exception/validate.exception';
import { ErrorCode } from 'src/utils/error.code';
import { BlogUpdatedEvent } from '../events/blog-updated.event';

@Injectable()
export class UpdateBlogUseCase {
  constructor(
    @Inject(BLOG_REPOSITORY)
    private readonly blogRepository: IBlogRepository,
    private readonly eventBus: EventBus,
  ) {}

  async execute(id: string, request: UpdateBlogRequest): Promise<UpdateBlogResponse> {
    const existingBlog = await this.blogRepository.findById(id);
    if (!existingBlog) {
      throw new ValidateException(ErrorCode.BLOG_NOT_FOUND, `Blog ${id} not found`);
    }

    const blog = await this.blogRepository.update(id, {
      title: request.title,
      content: request.content,
    });
    if (!blog) {
      throw new ValidateException(ErrorCode.BLOG_NOT_FOUND, `Blog ${id} not found`);
    }

    this.eventBus.publish(new BlogUpdatedEvent(blog));

    return new UpdateBlogResponse(blog);
  }
}
