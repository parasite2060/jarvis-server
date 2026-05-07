import { AuditLog } from '../entities/audit-log.entity';

export const AUDIT_LOG_REPOSITORY = Symbol('AUDIT_LOG_REPOSITORY');

export interface AuditLogPaginationOptions {
  page: number;
  limit: number;
}

export interface IAuditLogRepository {
  create(log: Partial<AuditLog>): Promise<AuditLog>;
  findById(id: string): Promise<AuditLog | null>;
  findByEntityId(entityId: string, options: AuditLogPaginationOptions): Promise<{ items: AuditLog[]; total: number }>;
  findAll(options: AuditLogPaginationOptions): Promise<{ items: AuditLog[]; total: number }>;
}
