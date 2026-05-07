import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Comment } from 'src/shared/domain/entities/comment.entity';
import { ICommentRepository } from 'src/shared/domain/repositories/comment.repository.interface';
import { CommentSchema } from '../schema/comment.schema';
import { DBConnections } from '../utils/constaint';

@Injectable()
export class CommentRepositoryImpl implements ICommentRepository {
  constructor(
    @InjectRepository(CommentSchema, DBConnections.INTERNAL)
    private readonly repository: Repository<Comment>,
  ) {}

  async create(comment: Partial<Comment>): Promise<Comment> {
    const entity = this.repository.create(comment);
    return await this.repository.save(entity);
  }

  async findById(id: string): Promise<Comment | null> {
    return await this.repository.findOne({
      where: { id, isValid: true },
    });
  }

  async findByBlogId(blogId: string, options: { page: number; limit: number }): Promise<{ items: Comment[]; total: number }> {
    const [items, total] = await this.repository.findAndCount({
      where: { blogId, isValid: true },
      order: { createdAt: 'DESC' },
      skip: (options.page - 1) * options.limit,
      take: options.limit,
    });
    return { items, total };
  }

  async update(id: string, data: Partial<Comment>): Promise<Comment | null> {
    await this.repository.update({ id, isValid: true }, data);
    return await this.findById(id);
  }

  async softDelete(id: string): Promise<boolean> {
    const result = await this.repository.update({ id, isValid: true }, { isValid: false });
    return result.affected !== undefined && result.affected > 0;
  }
}
