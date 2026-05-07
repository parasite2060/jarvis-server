import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditLog } from 'src/shared/domain/entities/audit-log.entity';
import { AuditLogPaginationOptions, IAuditLogRepository } from 'src/shared/domain/repositories/audit-log.repository.interface';
import { AuditLogDocument } from '../schemas/audit-log.schema';

@Injectable()
export class AuditLogRepository implements IAuditLogRepository {
  constructor(
    @InjectModel(AuditLogDocument.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
  ) {}

  async create(log: Partial<AuditLog>): Promise<AuditLog> {
    const result = await this.auditLogModel.create(log);
    return this.mapToEntity(result);
  }

  async findById(id: string): Promise<AuditLog | null> {
    const result = await this.auditLogModel.findById(id);
    return result ? this.mapToEntity(result) : null;
  }

  async findByEntityId(entityId: string, options: AuditLogPaginationOptions): Promise<{ items: AuditLog[]; total: number }> {
    const skip = (options.page - 1) * options.limit;

    const [items, total] = await Promise.all([
      this.auditLogModel.find({ entityId }).sort({ timestamp: -1 }).skip(skip).limit(options.limit).exec(),
      this.auditLogModel.countDocuments({ entityId }).exec(),
    ]);

    return {
      items: items.map((doc) => this.mapToEntity(doc)),
      total,
    };
  }

  async findAll(options: AuditLogPaginationOptions): Promise<{ items: AuditLog[]; total: number }> {
    const skip = (options.page - 1) * options.limit;

    const [items, total] = await Promise.all([
      this.auditLogModel.find().sort({ timestamp: -1 }).skip(skip).limit(options.limit).exec(),
      this.auditLogModel.countDocuments().exec(),
    ]);

    return {
      items: items.map((doc) => this.mapToEntity(doc)),
      total,
    };
  }

  private mapToEntity(doc: AuditLogDocument): AuditLog {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _id, __v, ...rest } = doc.toObject();
    return new AuditLog({
      id: _id.toString(),
      ...rest,
    });
  }
}
