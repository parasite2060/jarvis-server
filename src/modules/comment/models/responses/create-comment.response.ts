import { Comment } from 'src/shared/domain/entities/comment.entity';

export class CreateCommentResponse {
  id: string;
  blogId: string;
  createdAt: Date;

  constructor(comment: Comment) {
    this.id = comment.id;
    this.blogId = comment.blogId;
    this.createdAt = comment.createdAt;
  }
}
