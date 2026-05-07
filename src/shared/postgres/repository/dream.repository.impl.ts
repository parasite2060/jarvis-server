import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { Dream } from 'src/shared/domain/entities/dream.entity';
import { IDreamRepository } from 'src/shared/domain/repositories/dream.repository.interface';
import { DreamSchema } from '../schema/dream.schema';
import { DBConnections } from '../utils/constaint';

@Injectable()
export class DreamRepositoryImpl implements IDreamRepository {
  constructor(
    @InjectRepository(DreamSchema, DBConnections.INTERNAL)
    private readonly repository: Repository<Dream>,
  ) {}

  async createDream(input: Partial<Dream>): Promise<Dream> {
    const entity = this.repository.create(input);
    return await this.repository.save(entity);
  }

  async updateDreamOutcome(id: number, outcome: string, status?: string): Promise<void> {
    const patch: QueryDeepPartialEntity<Dream> = { outcome };
    if (status !== undefined) patch.status = status;
    await this.repository.update({ id }, patch);
  }

  async persistSessionLog(id: number, sessionLog: Record<string, unknown>): Promise<void> {
    await this.repository.update({ id }, { sessionLog } as QueryDeepPartialEntity<Dream>);
  }

  async findByDate(date: string): Promise<Dream[]> {
    // `date` is a UTC `YYYY-MM-DD`. Match all rows whose `created_at` falls on that day.
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return await this.repository.find({
      where: { createdAt: Between(start, end) },
      order: { createdAt: 'ASC' },
    });
  }

  async findById(id: number): Promise<Dream | null> {
    return await this.repository.findOne({ where: { id } });
  }
}
