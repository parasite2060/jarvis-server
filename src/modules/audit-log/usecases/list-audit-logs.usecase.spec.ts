import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { ListAuditLogsUseCase } from './list-audit-logs.usecase';
import { IAuditLogRepository, AUDIT_LOG_REPOSITORY } from 'src/shared/domain/repositories/audit-log.repository.interface';
import { AuditLog } from 'src/shared/domain/entities/audit-log.entity';
import { ListAuditLogsRequest } from '../models/requests/list-audit-logs.request';
import { PaginatedAuditLogsPresenter } from '../models/presenters/paginated-audit-logs.presenter';

describe('ListAuditLogsUseCase', () => {
  let target: ListAuditLogsUseCase;
  let mockAuditLogRepository: DeepMocked<IAuditLogRepository>;

  beforeEach(async () => {
    // Arrange: Create mocks
    mockAuditLogRepository = createMock<IAuditLogRepository>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [ListAuditLogsUseCase, { provide: AUDIT_LOG_REPOSITORY, useValue: mockAuditLogRepository }],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = module.get<ListAuditLogsUseCase>(ListAuditLogsUseCase);
  });

  it('should return paginated audit logs for a specific entity', async () => {
    // Arrange
    const request: ListAuditLogsRequest = {
      entityId: 'blog-123',
      page: 1,
      limit: 10,
    };
    const mockAuditLogs = [
      new AuditLog({
        id: 'audit-1',
        eventCode: 'ORG01001',
        entityType: 'Blog',
        entityId: 'blog-123',
        action: 'CREATE',
        payload: { title: 'Test' },
        actor: { name: 'system' },
        timestamp: new Date('2024-01-01T00:00:00Z'),
        createdAt: new Date('2024-01-01T00:00:00Z'),
      }),
      new AuditLog({
        id: 'audit-2',
        eventCode: 'ORG01002',
        entityType: 'Blog',
        entityId: 'blog-123',
        action: 'UPDATE',
        payload: { title: 'Updated' },
        actor: { name: 'system' },
        timestamp: new Date('2024-01-02T00:00:00Z'),
        createdAt: new Date('2024-01-02T00:00:00Z'),
      }),
    ];
    mockAuditLogRepository.findByEntityId.mockResolvedValue({
      items: mockAuditLogs,
      total: 2,
    });

    // Act
    const result = await target.execute(request);

    // Assert
    expect(result).toBeInstanceOf(PaginatedAuditLogsPresenter);
    expect(result.total).toBe(2);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(10);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]!.eventCode).toBe('ORG01001');
    expect(result.items[1]!.eventCode).toBe('ORG01002');
    expect(mockAuditLogRepository.findByEntityId).toHaveBeenCalledWith('blog-123', { page: 1, limit: 10 });
    expect(mockAuditLogRepository.findByEntityId).toHaveBeenCalledTimes(1);
  });

  it('should return all audit logs when no entityId provided', async () => {
    // Arrange
    const request: ListAuditLogsRequest = {
      page: 1,
      limit: 20,
    };
    mockAuditLogRepository.findAll.mockResolvedValue({
      items: [],
      total: 0,
    });

    // Act
    const result = await target.execute(request);

    // Assert
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(mockAuditLogRepository.findAll).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(mockAuditLogRepository.findAll).toHaveBeenCalledTimes(1);
    expect(mockAuditLogRepository.findByEntityId).not.toHaveBeenCalled();
  });

  it('should use default pagination when not provided', async () => {
    // Arrange
    const request: ListAuditLogsRequest = {};
    mockAuditLogRepository.findAll.mockResolvedValue({
      items: [],
      total: 0,
    });

    // Act
    const result = await target.execute(request);

    // Assert
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(mockAuditLogRepository.findAll).toHaveBeenCalledWith({ page: 1, limit: 20 });
  });
});
