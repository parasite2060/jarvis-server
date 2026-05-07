import { Blog } from '../entities/blog.entity';

export const BLOG_REPOSITORY = Symbol('BLOG_REPOSITORY');

export interface PaginationOptions {
  page: number;
  limit: number;
}

export interface IBlogRepository {
  create(blog: Partial<Blog>): Promise<Blog>;
  findById(id: string): Promise<Blog | null>;
  findAll(options: PaginationOptions): Promise<{ items: Blog[]; total: number }>;
  update(id: string, data: Partial<Blog>): Promise<Blog | null>;
  softDelete(id: string): Promise<boolean>;
}
