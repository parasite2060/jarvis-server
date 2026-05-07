import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { HandleDomainEventUseCase } from './handle-domain-event.usecase';
import { DomainEventHandlerFactory } from './domain-event-handlers/domain-event-handler.factory';
import { DomainEventDto } from '../models/requests/domain-event.dto';

describe('HandleDomainEventUseCase', () => {
  let target: HandleDomainEventUseCase;
  let mockDomainEventHandlerFactory: DeepMocked<DomainEventHandlerFactory>;

  beforeEach(async () => {
    mockDomainEventHandlerFactory = createMock<DomainEventHandlerFactory>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HandleDomainEventUseCase,
        {
          provide: DomainEventHandlerFactory,
          useValue: mockDomainEventHandlerFactory,
        },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = module.get<HandleDomainEventUseCase>(HandleDomainEventUseCase);
  });

  it('should delegate to factory.handle()', async () => {
    // Arrange
    const event: DomainEventDto = {
      id: 'evt-123',
      code: 'ORG01001',
      timestamp: new Date('2024-01-01T00:00:00Z'),
      payload: { blogId: 'blog-123', title: 'Test Blog', authorId: 'author-123' },
    };
    mockDomainEventHandlerFactory.handle.mockResolvedValue();

    // Act
    await target.execute(event);

    // Assert
    expect(mockDomainEventHandlerFactory.handle).toHaveBeenCalledWith(event);
    expect(mockDomainEventHandlerFactory.handle).toHaveBeenCalledTimes(1);
  });

  it('should re-throw errors from factory', async () => {
    // Arrange
    const event: DomainEventDto = {
      id: 'evt-123',
      code: 'ORG01001',
      timestamp: new Date('2024-01-01T00:00:00Z'),
      payload: {},
    };
    mockDomainEventHandlerFactory.handle.mockRejectedValue(new Error('Factory error'));

    // Act & Assert
    await expect(target.execute(event)).rejects.toThrow('Factory error');
    expect(mockDomainEventHandlerFactory.handle).toHaveBeenCalledTimes(1);
  });
});
