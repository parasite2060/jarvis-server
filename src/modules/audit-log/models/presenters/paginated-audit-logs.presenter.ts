import { AuditLog } from 'src/shared/domain/entities/audit-log.entity';
import { AuditLogPresenter } from './audit-log.presenter';

export class PaginatedAuditLogsPresenter {
  items: AuditLogPresenter[];
  total: number;
  page: number;
  limit: number;

  constructor(data: { items: AuditLog[]; total: number; page: number; limit: number }) {
    this.items = data.items.map((log) => new AuditLogPresenter(log));
    this.total = data.total;
    this.page = data.page;
    this.limit = data.limit;
  }
}
