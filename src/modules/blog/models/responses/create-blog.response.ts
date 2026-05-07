import { Blog } from 'src/shared/domain/entities/blog.entity';

export class CreateBlogResponse {
  id: string;
  title: string;
  createdAt: Date;

  constructor(blog: Blog) {
    this.id = blog.id;
    this.title = blog.title;
    this.createdAt = blog.createdAt;
  }
}
