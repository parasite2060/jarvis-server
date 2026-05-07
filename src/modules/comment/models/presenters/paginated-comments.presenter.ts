import { Comment } from 'src/shared/domain/entities/comment.entity';
import { CommentPresenter } from './comment.presenter';

export class PaginatedCommentsPresenter {
  items: CommentPresenter[];
  total: number;
  page: number;
  limit: number;

  constructor(data: { items: Comment[]; total: number; page: number; limit: number }) {
    this.items = data.items.map((comment) => new CommentPresenter(comment));
    this.total = data.total;
    this.page = data.page;
    this.limit = data.limit;
  }
}
