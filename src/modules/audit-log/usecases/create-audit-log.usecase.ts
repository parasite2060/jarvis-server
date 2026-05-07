import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_LOG_REPOSITORY, IAuditLogRepository } from 'src/shared/domain/repositories/audit-log.repository.interface';
import { DomainEventDto } from '../models/requests/domain-event.dto';
import { AuditLogAction } from 'src/shared/domain/entities/audit-log.entity';

@Injectable()
export class CreateAuditLogUseCase {
  constructor(
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogRepository: IAuditLogRepository,
  ) {}

  async execute(event: DomainEventDto, entityType: string, action: AuditLogAction): Promise<void> {
    await this.auditLogRepository.create({
      eventCode: event.code,
      entityType,
      entityId: event.id,
      action,
      payload: event.payload,
      actor: event.actor || { name: 'system' },
      timestamp: new Date(event.timestamp),
    });
  }
}
