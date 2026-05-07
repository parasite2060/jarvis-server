import { DataSource } from 'typeorm';
import { Blog } from '../../src/shared/domain/entities/blog.entity';
import { BlogSchema } from '../../src/shared/postgres/schema/blog.schema';

export class BlogFactory {
  private static counter = 0;

  constructor(private readonly dataSource: DataSource) {}

  async create(overrides: Partial<Blog> = {}): Promise<Blog> {
    BlogFactory.counter++;
    const repo = this.dataSource.getRepository(BlogSchema);

    const blog = repo.create({
      title: `Test Blog ${BlogFactory.counter}`,
      content: `Content for test blog ${BlogFactory.counter}`,
      authorId: `author-${BlogFactory.counter}`,
      isValid: true,
      ...overrides,
    });

    return repo.save(blog);
  }

  async createMany(count: number, overrides: Partial<Blog> = {}): Promise<Blog[]> {
    const blogs: Blog[] = [];
    for (let i = 0; i < count; i++) {
      blogs.push(await this.create(overrides));
    }
    return blogs;
  }

  static reset(): void {
    BlogFactory.counter = 0;
  }
}
