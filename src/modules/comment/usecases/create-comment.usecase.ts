import { Inject, Injectable } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { COMMENT_REPOSITORY, ICommentRepository } from 'src/shared/domain/repositories/comment.repository.interface';
import { BLOG_REPOSITORY, IBlogRepository } from 'src/shared/domain/repositories/blog.repository.interface';
import { CreateCommentRequest } from '../models/requests/create-comment.request';
import { CreateCommentResponse } from '../models/responses/create-comment.response';
import { ValidateException } from 'src/shared/common/models/exception/validate.exception';
import { ErrorCode } from 'src/utils/error.code';
import { CommentCreatedEvent } from '../events/comment-created.event';

@Injectable()
export class CreateCommentUseCase {
  constructor(
    @Inject(COMMENT_REPOSITORY)
    private readonly commentRepository: ICommentRepository,
    @Inject(BLOG_REPOSITORY)
    private readonly blogRepository: IBlogRepository,
    private readonly eventBus: EventBus,
  ) {}

  async execute(request: CreateCommentRequest): Promise<CreateCommentResponse> {
    const blog = await this.blogRepository.findById(request.blogId);
    if (!blog) {
      throw new ValidateException(ErrorCode.COMMENT_BLOG_NOT_FOUND, `Blog ${request.blogId} not found`);
    }

    const comment = await this.commentRepository.create({
      content: request.content,
      blogId: request.blogId,
      authorId: request.authorId,
    });

    this.eventBus.publish(new CommentCreatedEvent(comment));

    return new CreateCommentResponse(comment);
  }
}
