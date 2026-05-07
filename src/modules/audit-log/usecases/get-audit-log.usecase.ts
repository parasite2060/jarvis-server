import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_LOG_REPOSITORY, IAuditLogRepository } from 'src/shared/domain/repositories/audit-log.repository.interface';
import { AuditLogPresenter } from '../models/presenters/audit-log.presenter';
import { ValidateException } from 'src/shared/common/models/exception/validate.exception';
import { ErrorCode } from 'src/utils/error.code';

@Injectable()
export class GetAuditLogUseCase {
  constructor(
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogRepository: IAuditLogRepository,
  ) {}

  async execute(id: string): Promise<AuditLogPresenter> {
    const auditLog = await this.auditLogRepository.findById(id);
    if (!auditLog) {
      throw new ValidateException(ErrorCode.AUDIT_LOG_NOT_FOUND, `Audit log ${id} not found`);
    }

    return new AuditLogPresenter(auditLog);
  }
}
