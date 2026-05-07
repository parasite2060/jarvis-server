import { EntitySchema } from 'typeorm';
import { Blog } from 'src/shared/domain/entities/blog.entity';

export const BlogSchema = new EntitySchema<Blog>({
  name: 'Blog',
  tableName: 'blogs',
  columns: {
    id: {
      type: 'uuid',
      primary: true,
      generated: 'uuid',
    },
    title: {
      type: 'varchar',
      length: 200,
    },
    content: {
      type: 'text',
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
      name: 'idx_blogs_author_id',
      columns: ['authorId'],
    },
    {
      name: 'idx_blogs_is_valid',
      columns: ['isValid'],
    },
  ],
});
