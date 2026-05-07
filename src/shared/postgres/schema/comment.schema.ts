import { EntitySchema } from 'typeorm';
import { Comment } from 'src/shared/domain/entities/comment.entity';

export const CommentSchema = new EntitySchema<Comment>({
  name: 'Comment',
  tableName: 'comments',
  columns: {
    id: {
      type: 'uuid',
      primary: true,
      generated: 'uuid',
    },
    content: {
      type: 'text',
    },
    blogId: {
      name: 'blog_id',
      type: 'uuid',
    },
    authorId: {
      name: 'author_id',
      type: 'varchar',
      length: 100,
    },
    isValid: {
      name: 'is_valid',
      type: 'boolean',
      default: true,
    },
    createdAt: {
      name: 'created_at',
      type: 'timestamp with time zone',
      createDate: true,
    },
    updatedAt: {
      name: 'updated_at',
      type: 'timestamp with time zone',
      updateDate: true,
    },
  },
  indices: [
    {
      name: 'idx_comments_blog_id',
      columns: ['blogId'],
    },
    {
      name: 'idx_comments_author_id',
      columns: ['authorId'],
    },
    {
      name: 'idx_comments_is_valid',
      columns: ['isValid'],
    },
  ],
});
