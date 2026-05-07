import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { ModuleRef } from '@nestjs/core';
import { DomainEventHandlerFactory } from './domain-event-handler.factory';
import { IDomainEventHandler } from './domain-event-handler.interface';
import { DOMAIN_EVENT_HANDLER_METADATA } from './constants';
import { DomainEventDto } from '../../models/requests/domain-event.dto';

describe('DomainEventHandlerFactory', () => {
  let target: DomainEventHandlerFactory;
  let mockModuleRef: DeepMocked<ModuleRef>;

  class MockHandler implements IDomainEventHandler {
    async handle(): Promise<void> {
      return Promise.resolve();
    }
  }

  beforeEach(async () => {
    mockModuleRef = createMock<ModuleRef>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DomainEventHandlerFactory,
        {
          provide: ModuleRef,
          useValue: mockModuleRef,
        },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = module.get<DomainEventHandlerFactory>(DomainEventHandlerFactory);
  });

  describe('register', () => {
    it('should register handler types', () => {
      // Arrange
      Reflect.defineMetadata(DOMAIN_EVENT_HANDLER_METADATA, 'TEST001', MockHandler);

      // Act
      target.register([MockHandler]);

      // Assert
      expect(target['eventHandlerTypes']).toContain(MockHandler);
    });
  });

  describe('getHandler', () => {
    it('should return handler for registered event code', async () => {
      // Arrange
      Reflect.defineMetadata(DOMAIN_EVENT_HANDLER_METADATA, 'TEST001', MockHandler);
      const mockHandler = new MockHandler();
      target.register([MockHandler]);
      mockModuleRef.get.mockReturnValue(mockHandler);

      // Act
      const handler = await target.getHandler('TEST001');

      // Assert
      expect(handler).toBe(mockHandler);
      expect(mockModuleRef.get).toHaveBeenCalledWith(MockHandler, { strict: false });
      expect(mockModuleRef.get).toHaveBeenCalledTimes(1);
    });

    it('should return null for unknown event code', async () => {
      // Arrange
      target.register([]);

      // Act
      const handler = await target.getHandler('UNKNOWN999');

      // Assert
      expect(handler).toBeNull();
    });

    it('should cache handler instances', async () => {
      // Arrange
      Reflect.defineMetadata(DOMAIN_EVENT_HANDLER_METADATA, 'TEST001', MockHandler);
      const mockHandler = new MockHandler();
      target.register([MockHandler]);
      mockModuleRef.get.mockReturnValue(mockHandler);

      // Act
      await target.getHandler('TEST001');
      await target.getHandler('TEST001');

      // Assert
      expect(mockModuleRef.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('handle', () => {
    it('should delegate to correct handler', async () => {
      // Arrange
      Reflect.defineMetadata(DOMAIN_EVENT_HANDLER_METADATA, 'TEST001', MockHandler);
      const mockHandler = createMock<IDomainEventHandler>();
      target.register([MockHandler]);
      mockModuleRef.get.mockReturnValue(mockHandler);
      const event: DomainEventDto = {
        id: 'evt-123',
        code: 'TEST001',
        timestamp: new Date('2024-01-01T00:00:00Z'),
        payload: { test: 'data' },
      };

      // Act
      await target.handle(event);

      // Assert
      expect(mockHandler.handle).toHaveBeenCalledWith(event);
      expect(mockHandler.handle).toHaveBeenCalledTimes(1);
    });

    it('should skip unknown events gracefully', async () => {
      // Arrange
      target.register([]);
      const event: DomainEventDto = {
        id: 'evt-123',
        code: 'UNKNOWN999',
        timestamp: new Date('2024-01-01T00:00:00Z'),
        payload: {},
      };

      // Act & Assert
      await expect(target.handle(event)).resolves.not.toThrow();
    });

    it('should re-throw handler errors', async () => {
      // Arrange
      Reflect.defineMetadata(DOMAIN_EVENT_HANDLER_METADATA, 'TEST001', MockHandler);
      const mockHandler = createMock<IDomainEventHandler>();
      mockHandler.handle.mockRejectedValue(new Error('Handler error'));
      target.register([MockHandler]);
      mockModuleRef.get.mockReturnValue(mockHandler);
      const event: DomainEventDto = {
        id: 'evt-123',
        code: 'TEST001',
        timestamp: new Date('2024-01-01T00:00:00Z'),
        payload: {},
      };

      // Act & Assert
      await expect(target.handle(event)).rejects.toThrow('Handler error');
      expect(mockHandler.handle).toHaveBeenCalledTimes(1);
    });
  });
});
