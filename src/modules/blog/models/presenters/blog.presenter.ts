import { Blog } from 'src/shared/domain/entities/blog.entity';

export class BlogPresenter {
  id: string;
  title: string;
  content: string;
  authorId: string;
  createdAt: Date;
  updatedAt: Date;

  constructor(blog: Blog) {
    this.id = blog.id;
    this.title = blog.title;
    this.content = blog.content;
    this.authorId = blog.authorId;
    this.createdAt = blog.createdAt;
    this.updatedAt = blog.updatedAt;
  }
}
