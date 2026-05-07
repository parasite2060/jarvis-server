import { CreateAuditLogUseCase } from './create-audit-log.usecase';
import { GetAuditLogUseCase } from './get-audit-log.usecase';
import { ListAuditLogsUseCase } from './list-audit-logs.usecase';
import { HandleDomainEventUseCase } from './handle-domain-event.usecase';

export const UseCases = [CreateAuditLogUseCase, GetAuditLogUseCase, ListAuditLogsUseCase, HandleDomainEventUseCase];

export { CreateAuditLogUseCase, GetAuditLogUseCase, ListAuditLogsUseCase, HandleDomainEventUseCase };
