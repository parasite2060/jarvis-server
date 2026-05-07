import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { CreateAuditLogUseCase } from './create-audit-log.usecase';
import { IAuditLogRepository, AUDIT_LOG_REPOSITORY } from 'src/shared/domain/repositories/audit-log.repository.interface';
import { AuditLog } from 'src/shared/domain/entities/audit-log.entity';
import { DomainEventDto } from '../models/requests/domain-event.dto';

describe('CreateAuditLogUseCase', () => {
  let target: CreateAuditLogUseCase;
  let mockAuditLogRepository: DeepMocked<IAuditLogRepository>;

  beforeEach(async () => {
    mockAuditLogRepository = createMock<IAuditLogRepository>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [CreateAuditLogUseCase, { provide: AUDIT_LOG_REPOSITORY, useValue: mockAuditLogRepository }],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = module.get<CreateAuditLogUseCase>(CreateAuditLogUseCase);
  });

  it('should create audit log for CREATE event (ORG01001)', async () => {
    // Arrange
    const event: DomainEventDto = {
      id: 'blog-123',
      code: 'ORG01001',
      timestamp: new Date('2024-01-01T00:00:00Z'),
      actor: { id: 'user-1', name: 'John Doe' },
      source: { system: 'template', service: 'blog-service', module: 'blog' },
      payload: { blogId: 'blog-123', title: 'Test Blog', authorId: 'author-1' },
    };
    const expectedAuditLog = new AuditLog({
      id: 'audit-123',
      eventCode: 'ORG01001',
      entityType: 'Blog',
      entityId: 'blog-123',
      action: 'CREATE',
      payload: event.payload,
      actor: { id: 'user-1', name: 'John Doe' },
      timestamp: new Date('2024-01-01T00:00:00Z'),
      createdAt: new Date(),
    });
    mockAuditLogRepository.create.mockResolvedValue(expectedAuditLog);

    // Act
    await target.execute(event, 'Blog', 'CREATE');

    // Assert
    expect(mockAuditLogRepository.create).toHaveBeenCalledWith({
      eventCode: 'ORG01001',
      entityType: 'Blog',
      entityId: 'blog-123',
      action: 'CREATE',
      payload: event.payload,
      actor: { id: 'user-1', name: 'John Doe' },
      timestamp: new Date('2024-01-01T00:00:00Z'),
    });
    expect(mockAuditLogRepository.create).toHaveBeenCalledTimes(1);
  });

  it('should create audit log for UPDATE event (ORG01002)', async () => {
    // Arrange
    const event: DomainEventDto = {
      id: 'blog-123',
      code: 'ORG01002',
      timestamp: new Date('2024-01-01T00:00:00Z'),
      payload: { blogId: 'blog-123', title: 'Updated Blog' },
    };
    mockAuditLogRepository.create.mockResolvedValue(new AuditLog());

    // Act
    await target.execute(event, 'Blog', 'UPDATE');

    // Assert
    expect(mockAuditLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventCode: 'ORG01002',
        entityType: 'Blog',
        entityId: 'blog-123',
        action: 'UPDATE',
        actor: { name: 'system' },
      }),
    );
    expect(mockAuditLogRepository.create).toHaveBeenCalledTimes(1);
  });

  it('should create audit log for DELETE event (ORG01003)', async () => {
    // Arrange
    const event: DomainEventDto = {
      id: 'blog-123',
      code: 'ORG01003',
      timestamp: new Date('2024-01-01T00:00:00Z'),
      payload: { blogId: 'blog-123' },
    };
    mockAuditLogRepository.create.mockResolvedValue(new AuditLog());

    // Act
    await target.execute(event, 'Blog', 'DELETE');

    // Assert
    expect(mockAuditLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventCode: 'ORG01003',
        entityType: 'Blog',
        entityId: 'blog-123',
        action: 'DELETE',
      }),
    );
    expect(mockAuditLogRepository.create).toHaveBeenCalledTimes(1);
  });

  it('should create audit log for Comment events (ORG02xxx)', async () => {
    // Arrange
    const event: DomainEventDto = {
      id: 'comment-123',
      code: 'ORG02001',
      timestamp: new Date('2024-01-01T00:00:00Z'),
      payload: { commentId: 'comment-123', blogId: 'blog-456' },
    };
    mockAuditLogRepository.create.mockResolvedValue(new AuditLog());

    // Act
    await target.execute(event, 'Comment', 'CREATE');

    // Assert
    expect(mockAuditLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventCode: 'ORG02001',
        entityType: 'Comment',
        entityId: 'comment-123',
        action: 'CREATE',
      }),
    );
    expect(mockAuditLogRepository.create).toHaveBeenCalledTimes(1);
  });

  it('should use system as default actor when not provided', async () => {
    // Arrange
    const event: DomainEventDto = {
      id: 'blog-123',
      code: 'ORG01001',
      timestamp: new Date('2024-01-01T00:00:00Z'),
      payload: {},
    };
    mockAuditLogRepository.create.mockResolvedValue(new AuditLog());

    // Act
    await target.execute(event, 'Blog', 'CREATE');

    // Assert
    expect(mockAuditLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { name: 'system' },
      }),
    );
  });
});
