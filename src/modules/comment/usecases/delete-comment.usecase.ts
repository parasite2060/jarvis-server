import { Inject, Injectable } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { COMMENT_REPOSITORY, ICommentRepository } from 'src/shared/domain/repositories/comment.repository.interface';
import { ValidateException } from 'src/shared/common/models/exception/validate.exception';
import { ErrorCode } from 'src/utils/error.code';
import { CommentDeletedEvent } from '../events/comment-deleted.event';

@Injectable()
export class DeleteCommentUseCase {
  constructor(
    @Inject(COMMENT_REPOSITORY)
    private readonly commentRepository: ICommentRepository,
    private readonly eventBus: EventBus,
  ) {}

  async execute(id: string): Promise<void> {
    const existingComment = await this.commentRepository.findById(id);
    if (!existingComment) {
      throw new ValidateException(ErrorCode.COMMENT_NOT_FOUND, `Comment ${id} not found`);
    }

    const deleted = await this.commentRepository.softDelete(id);

    if (deleted) {
      this.eventBus.publish(new CommentDeletedEvent(existingComment));
    }
  }
}
