import { Inject, Injectable } from '@nestjs/common';
import { COMMENT_REPOSITORY, ICommentRepository } from 'src/shared/domain/repositories/comment.repository.interface';
import { CommentPresenter } from '../models/presenters/comment.presenter';
import { ValidateException } from 'src/shared/common/models/exception/validate.exception';
import { ErrorCode } from 'src/utils/error.code';

@Injectable()
export class GetCommentUseCase {
  constructor(
    @Inject(COMMENT_REPOSITORY)
    private readonly commentRepository: ICommentRepository,
  ) {}

  async execute(id: string): Promise<CommentPresenter> {
    const comment = await this.commentRepository.findById(id);
    if (!comment) {
      throw new ValidateException(ErrorCode.COMMENT_NOT_FOUND, `Comment ${id} not found`);
    }

    return new CommentPresenter(comment);
  }
}
