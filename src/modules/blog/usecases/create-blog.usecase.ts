import { Inject, Injectable } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { BLOG_REPOSITORY, IBlogRepository } from 'src/shared/domain/repositories/blog.repository.interface';
import { CreateBlogRequest } from '../models/requests/create-blog.request';
import { CreateBlogResponse } from '../models/responses/create-blog.response';
import { BlogCreatedEvent } from '../events/blog-created.event';

@Injectable()
export class CreateBlogUseCase {
  constructor(
    @Inject(BLOG_REPOSITORY)
    private readonly blogRepository: IBlogRepository,
    private readonly eventBus: EventBus,
  ) {}

  async execute(request: CreateBlogRequest): Promise<CreateBlogResponse> {
    const blog = await this.blogRepository.create({
      title: request.title,
      content: request.content,
      authorId: request.authorId,
    });

    this.eventBus.publish(new BlogCreatedEvent(blog));

    return new CreateBlogResponse(blog);
  }
}
