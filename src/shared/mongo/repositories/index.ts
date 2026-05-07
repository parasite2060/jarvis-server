import { Provider } from '@nestjs/common';
import { AuditLogRepository } from './audit-log.repository.impl';
import { AUDIT_LOG_REPOSITORY } from 'src/shared/domain/repositories/audit-log.repository.interface';

// MongoDB repository implementations - add new repositories here
export const Repositories: Provider[] = [{ provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository }];
