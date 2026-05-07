export type AuditLogAction = 'CREATE' | 'UPDATE' | 'DELETE';

export interface AuditLogActor {
  id?: string;
  name: string;
}

export class AuditLog {
  id!: string;
  eventCode!: string;
  entityType!: string;
  entityId!: string;
  action!: AuditLogAction;
  payload!: Record<string, unknown>;
  actor!: AuditLogActor;
  timestamp!: Date;
  createdAt!: Date;

  constructor(init?: Partial<AuditLog>) {
    Object.assign(this, init);
  }
}
