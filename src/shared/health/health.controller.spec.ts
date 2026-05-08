import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { HealthCheckService, MongooseHealthIndicator, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { HealthController } from './health.controller';
import { RedisHealthIndicator, RedisToken } from '@nestjs-redis/kit';
import { DBConnections } from '../postgres/utils/constaint';
import { TemporalHealthIndicator } from './indicators/temporal.indicator';
import { MemuHealthIndicator } from './indicators/memu.indicator';

describe('HealthController', () => {
  let target: HealthController;
  let mockHealthService: DeepMocked<HealthCheckService>;
  let mockRedisHealthIndicator: DeepMocked<RedisHealthIndicator>;
  let mockTemporalIndicator: DeepMocked<TemporalHealthIndicator>;
  let mockMemuIndicator: DeepMocked<MemuHealthIndicator>;

  beforeEach(async () => {
    mockHealthService = createMock<HealthCheckService>();
    mockRedisHealthIndicator = createMock<RedisHealthIndicator>();
    mockTemporalIndicator = createMock<TemporalHealthIndicator>();
    mockMemuIndicator = createMock<MemuHealthIndicator>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: HealthCheckService,
          useValue: mockHealthService,
        },
        {
          provide: RedisHealthIndicator,
          useValue: mockRedisHealthIndicator,
        },
        {
          provide: RedisToken(),
          useValue: createMock(),
        },
        {
          provide: TypeOrmHealthIndicator,
          useValue: createMock<TypeOrmHealthIndicator>(),
        },
        {
          provide: MongooseHealthIndicator,
          useValue: createMock<MongooseHealthIndicator>(),
        },
        {
          provide: getDataSourceToken(DBConnections.INTERNAL),
          useValue: createMock<DataSource>(),
        },
        {
          provide: TemporalHealthIndicator,
          useValue: mockTemporalIndicator,
        },
        {
          provide: MemuHealthIndicator,
          useValue: mockMemuIndicator,
        },
      ],
      controllers: [HealthController],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(target).toBeDefined();
  });

  describe('check', () => {
    it('should call health.check with health indicators', async () => {
      // Arrange
      mockHealthService.check.mockResolvedValue({
        status: 'ok',
        info: {
          application: { status: 'up', message: 'Up and running' },
          temporal: { status: 'up', message: 'connected' },
        },
        error: {},
        details: {
          application: { status: 'up', message: 'Up and running' },
          temporal: { status: 'up', message: 'connected' },
        },
      });

      // Act
      const result = await target.check();

      // Assert
      expect(mockHealthService.check).toHaveBeenCalled();
      expect(result.status).toBe('ok');
    });

    it('should include the temporal indicator in the indicator list', async () => {
      // Arrange — Story 13.8 retrofit: indicator is async + reports
      // 'connected' / 'not-connected' / 'unreachable: ...' instead of the
      // Story 13.1 'not-yet-bootstrapped' placeholder.
      mockTemporalIndicator.isHealthy.mockResolvedValue({
        temporal: { status: 'up', message: 'connected' },
      });
      mockHealthService.check.mockImplementation(async (indicators) => {
        // Run all indicator factories so we can verify the temporal one was passed.
        await Promise.all(indicators.map((fn) => fn()));
        return {
          status: 'ok',
          info: {},
          error: {},
          details: {},
        };
      });

      // Act
      await target.check();

      // Assert
      expect(mockTemporalIndicator.isHealthy).toHaveBeenCalledWith('temporal');
    });

    it('should include the memu indicator in the indicator list', async () => {
      // Arrange
      mockMemuIndicator.isHealthy.mockResolvedValue({
        memu: { status: 'up', message: 'reachable' },
      });
      mockHealthService.check.mockImplementation(async (indicators) => {
        await Promise.all(indicators.map((fn) => fn()));
        return { status: 'ok', info: {}, error: {}, details: {} };
      });

      // Act
      await target.check();

      // Assert
      expect(mockMemuIndicator.isHealthy).toHaveBeenCalledWith('memu');
    });
  });
});
