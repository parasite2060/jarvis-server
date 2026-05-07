import { Inject, Injectable } from '@nestjs/common';
import { COMMENT_REPOSITORY, ICommentRepository } from 'src/shared/domain/repositories/comment.repository.interface';
import { ListCommentsRequest } from '../models/requests/list-comments.request';
import { PaginatedCommentsPresenter } from '../models/presenters/paginated-comments.presenter';
import { ValidateException } from 'src/shared/common/models/exception/validate.exception';
import { ErrorCode } from 'src/utils/error.code';

@Injectable()
export class ListCommentsUseCase {
  constructor(
    @Inject(COMMENT_REPOSITORY)
    private readonly commentRepository: ICommentRepository,
  ) {}

  async execute(request: ListCommentsRequest): Promise<PaginatedCommentsPresenter> {
    if (!request.blogId) {
      throw new ValidateException(ErrorCode.COMMENT_BLOG_ID_INVALID, 'blogId is required');
    }

    const page = request.page || 1;
    const limit = request.limit || 20;

    const { items, total } = await this.commentRepository.findByBlogId(request.blogId, { page, limit });

    return new PaginatedCommentsPresenter({
      items,
      total,
      page,
      limit,
    });
  }
}
