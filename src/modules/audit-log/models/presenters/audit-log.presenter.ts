import { AuditLog, AuditLogAction, AuditLogActor } from 'src/shared/domain/entities/audit-log.entity';

export class AuditLogPresenter {
  id: string;
  eventCode: string;
  entityType: string;
  entityId: string;
  action: AuditLogAction;
  payload: Record<string, unknown>;
  actor: AuditLogActor;
  timestamp: Date;
  createdAt: Date;

  constructor(auditLog: AuditLog) {
    this.id = auditLog.id;
    this.eventCode = auditLog.eventCode;
    this.entityType = auditLog.entityType;
    this.entityId = auditLog.entityId;
    this.action = auditLog.action;
    this.payload = auditLog.payload;
    this.actor = auditLog.actor;
    this.timestamp = auditLog.timestamp;
    this.createdAt = auditLog.createdAt;
  }
}
