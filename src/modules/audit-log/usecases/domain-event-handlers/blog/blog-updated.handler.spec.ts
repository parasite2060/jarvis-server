import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { BlogUpdatedHandler } from './blog-updated.handler';
import { CreateAuditLogUseCase } from '../../create-audit-log.usecase';
import { DomainEventDto } from '../../../models/requests/domain-event.dto';
import { BlogUpdatedPayload } from '../../../models/event-payloads/blog-updated.payload';

describe('BlogUpdatedHandler', () => {
  let target: BlogUpdatedHandler;
  let mockCreateAuditLogUseCase: DeepMocked<CreateAuditLogUseCase>;

  beforeEach(async () => {
    mockCreateAuditLogUseCase = createMock<CreateAuditLogUseCase>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlogUpdatedHandler,
        {
          provide: CreateAuditLogUseCase,
          useValue: mockCreateAuditLogUseCase,
        },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = module.get<BlogUpdatedHandler>(BlogUpdatedHandler);
  });

  it('should call CreateAuditLogUseCase with correct parameters', async () => {
    const event: DomainEventDto<BlogUpdatedPayload> = {
      id: 'evt-123',
      code: 'ORG01002',
      timestamp: new Date('2024-01-01T00:00:00Z'),
      payload: {
        blogId: '550e8400-e29b-41d4-a716-446655440001',
        title: 'Updated Blog',
        authorId: '550e8400-e29b-41d4-a716-446655440002',
        updatedFields: ['title'],
      },
    };
    mockCreateAuditLogUseCase.execute.mockResolvedValue();

    await target.handle(event);

    expect(mockCreateAuditLogUseCase.execute).toHaveBeenCalledWith(event, 'Blog', 'UPDATE');
    expect(mockCreateAuditLogUseCase.execute).toHaveBeenCalledTimes(1);
  });

  it('should re-throw use case errors', async () => {
    const event: DomainEventDto<BlogUpdatedPayload> = {
      id: 'evt-123',
      code: 'ORG01002',
      timestamp: new Date('2024-01-01T00:00:00Z'),
      payload: {
        blogId: '550e8400-e29b-41d4-a716-446655440001',
        title: 'Updated Blog',
        authorId: '550e8400-e29b-41d4-a716-446655440002',
      },
    };
    mockCreateAuditLogUseCase.execute.mockRejectedValue(new Error('Use case error'));

    await expect(target.handle(event)).rejects.toThrow('Use case error');
    expect(mockCreateAuditLogUseCase.execute).toHaveBeenCalledTimes(1);
  });
});
