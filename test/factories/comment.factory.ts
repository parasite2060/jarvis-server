import { DataSource } from 'typeorm';
import { Comment } from '../../src/shared/domain/entities/comment.entity';
import { CommentSchema } from '../../src/shared/postgres/schema/comment.schema';

export class CommentFactory {
  private static counter = 0;

  constructor(private readonly dataSource: DataSource) {}

  async create(blogId: string, overrides: Partial<Comment> = {}): Promise<Comment> {
    CommentFactory.counter++;
    const repo = this.dataSource.getRepository(CommentSchema);

    const comment = repo.create({
      blogId,
      content: `Test comment ${CommentFactory.counter}`,
      authorId: `commenter-${CommentFactory.counter}`,
      isValid: true,
      ...overrides,
    });

    return repo.save(comment);
  }

  async createMany(blogId: string, count: number, overrides: Partial<Comment> = {}): Promise<Comment[]> {
    const comments: Comment[] = [];
    for (let i = 0; i < count; i++) {
      comments.push(await this.create(blogId, overrides));
    }
    return comments;
  }

  static reset(): void {
    CommentFactory.counter = 0;
  }
}
