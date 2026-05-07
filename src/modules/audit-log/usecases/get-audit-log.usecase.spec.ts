import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { GetAuditLogUseCase } from './get-audit-log.usecase';
import { IAuditLogRepository, AUDIT_LOG_REPOSITORY } from 'src/shared/domain/repositories/audit-log.repository.interface';
import { AuditLog } from 'src/shared/domain/entities/audit-log.entity';
import { AuditLogPresenter } from '../models/presenters/audit-log.presenter';
import { ValidateException } from 'src/shared/common/models/exception/validate.exception';
import { ErrorCode } from 'src/utils/error.code';

describe('GetAuditLogUseCase', () => {
  let target: GetAuditLogUseCase;
  let mockAuditLogRepository: DeepMocked<IAuditLogRepository>;

  beforeEach(async () => {
    // Arrange: Create mocks
    mockAuditLogRepository = createMock<IAuditLogRepository>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [GetAuditLogUseCase, { provide: AUDIT_LOG_REPOSITORY, useValue: mockAuditLogRepository }],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = module.get<GetAuditLogUseCase>(GetAuditLogUseCase);
  });

  it('should return audit log presenter when found', async () => {
    // Arrange
    const auditLogId = 'audit-123';
    const mockAuditLog = new AuditLog({
      id: auditLogId,
      eventCode: 'ORG01001',
      entityType: 'Blog',
      entityId: 'blog-456',
      action: 'CREATE',
      payload: { blogId: 'blog-456', title: 'Test Blog' },
      actor: { id: 'user-1', name: 'John Doe' },
      timestamp: new Date('2024-01-01T00:00:00Z'),
      createdAt: new Date('2024-01-01T00:00:00Z'),
    });
    mockAuditLogRepository.findById.mockResolvedValue(mockAuditLog);

    // Act
    const result = await target.execute(auditLogId);

    // Assert
    expect(result).toBeInstanceOf(AuditLogPresenter);
    expect(result.id).toBe(auditLogId);
    expect(result.eventCode).toBe('ORG01001');
    expect(result.entityType).toBe('Blog');
    expect(result.entityId).toBe('blog-456');
    expect(result.action).toBe('CREATE');
    expect(result.payload).toEqual({ blogId: 'blog-456', title: 'Test Blog' });
    expect(result.actor).toEqual({ id: 'user-1', name: 'John Doe' });
    expect(mockAuditLogRepository.findById).toHaveBeenCalledWith(auditLogId);
    expect(mockAuditLogRepository.findById).toHaveBeenCalledTimes(1);
  });

  it('should throw ValidateException when audit log not found', async () => {
    // Arrange
    const auditLogId = 'non-existent-id';
    mockAuditLogRepository.findById.mockResolvedValue(null);

    // Act & Assert
    await expect(target.execute(auditLogId)).rejects.toThrow(ValidateException);
    await expect(target.execute(auditLogId)).rejects.toMatchObject({
      code: ErrorCode.AUDIT_LOG_NOT_FOUND,
    });
    expect(mockAuditLogRepository.findById).toHaveBeenCalledWith(auditLogId);
  });
});
