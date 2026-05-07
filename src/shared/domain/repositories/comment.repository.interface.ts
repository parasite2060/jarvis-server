import { Comment } from '../entities/comment.entity';

export const COMMENT_REPOSITORY = Symbol('COMMENT_REPOSITORY');

export interface CommentPaginationOptions {
  page: number;
  limit: number;
  blogId?: string;
}

export interface ICommentRepository {
  create(comment: Partial<Comment>): Promise<Comment>;
  findById(id: string): Promise<Comment | null>;
  findByBlogId(blogId: string, options: { page: number; limit: number }): Promise<{ items: Comment[]; total: number }>;
  update(id: string, data: Partial<Comment>): Promise<Comment | null>;
  softDelete(id: string): Promise<boolean>;
}
