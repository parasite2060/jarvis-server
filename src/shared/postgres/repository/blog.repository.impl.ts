import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Blog } from 'src/shared/domain/entities/blog.entity';
import { IBlogRepository, PaginationOptions } from 'src/shared/domain/repositories/blog.repository.interface';
import { BlogSchema } from '../schema/blog.schema';
import { DBConnections } from '../utils/constaint';

@Injectable()
export class BlogRepositoryImpl implements IBlogRepository {
  constructor(
    @InjectRepository(BlogSchema, DBConnections.INTERNAL)
    private readonly repository: Repository<Blog>,
  ) {}

  async create(blog: Partial<Blog>): Promise<Blog> {
    const entity = this.repository.create(blog);
    return await this.repository.save(entity);
  }

  async findById(id: string): Promise<Blog | null> {
    return await this.repository.findOne({
      where: { id, isValid: true },
    });
  }

  async findAll(options: PaginationOptions): Promise<{ items: Blog[]; total: number }> {
    const [items, total] = await this.repository.findAndCount({
      where: { isValid: true },
      order: { createdAt: 'DESC' },
      skip: (options.page - 1) * options.limit,
      take: options.limit,
    });
    return { items, total };
  }

  async update(id: string, data: Partial<Blog>): Promise<Blog | null> {
    await this.repository.update({ id, isValid: true }, data);
    return await this.findById(id);
  }

  async softDelete(id: string): Promise<boolean> {
    const result = await this.repository.update({ id, isValid: true }, { isValid: false });
    return result.affected !== undefined && result.affected > 0;
  }
}
