import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_LOG_REPOSITORY, IAuditLogRepository } from 'src/shared/domain/repositories/audit-log.repository.interface';
import { ListAuditLogsRequest } from '../models/requests/list-audit-logs.request';
import { PaginatedAuditLogsPresenter } from '../models/presenters/paginated-audit-logs.presenter';

@Injectable()
export class ListAuditLogsUseCase {
  constructor(
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogRepository: IAuditLogRepository,
  ) {}

  async execute(request: ListAuditLogsRequest): Promise<PaginatedAuditLogsPresenter> {
    const page = request.page || 1;
    const limit = request.limit || 20;

    let result: { items: import('src/shared/domain/entities/audit-log.entity').AuditLog[]; total: number };

    if (request.entityId) {
      result = await this.auditLogRepository.findByEntityId(request.entityId, { page, limit });
    } else {
      result = await this.auditLogRepository.findAll({ page, limit });
    }

    return new PaginatedAuditLogsPresenter({
      items: result.items,
      total: result.total,
      page,
      limit,
    });
  }
}
