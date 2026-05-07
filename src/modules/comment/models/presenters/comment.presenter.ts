import { Comment } from 'src/shared/domain/entities/comment.entity';

export class CommentPresenter {
  id: string;
  content: string;
  blogId: string;
  authorId: string;
  createdAt: Date;
  updatedAt: Date;

  constructor(comment: Comment) {
    this.id = comment.id;
    this.content = comment.content;
    this.blogId = comment.blogId;
    this.authorId = comment.authorId;
    this.createdAt = comment.createdAt;
    this.updatedAt = comment.updatedAt;
  }
}
