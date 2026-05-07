import { Blog } from 'src/shared/domain/entities/blog.entity';
import { BlogPresenter } from './blog.presenter';

export class PaginatedBlogsPresenter {
  items: BlogPresenter[];
  total: number;
  page: number;
  limit: number;

  constructor(data: { items: Blog[]; total: number; page: number; limit: number }) {
    this.items = data.items.map((blog) => new BlogPresenter(blog));
    this.total = data.total;
    this.page = data.page;
    this.limit = data.limit;
  }
}
