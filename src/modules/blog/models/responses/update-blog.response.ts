import { Blog } from 'src/shared/domain/entities/blog.entity';

export class UpdateBlogResponse {
  id: string;
  title: string;
  updatedAt: Date;

  constructor(blog: Blog) {
    this.id = blog.id;
    this.title = blog.title;
    this.updatedAt = blog.updatedAt;
  }
}
