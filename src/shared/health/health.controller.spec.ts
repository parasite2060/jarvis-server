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

describe('HealthController', () => {
  let target: HealthController;
  let mockHealthService: DeepMocked<HealthCheckService>;
  let mockRedisHealthIndicator: DeepMocked<RedisHealthIndicator>;
  let mockTemporalIndicator: DeepMocked<TemporalHealthIndicator>;

  beforeEach(async () => {
    mockHealthService = createMock<HealthCheckService>();
    mockRedisHealthIndicator = createMock<RedisHealthIndicator>();
    mockTemporalIndicator = createMock<TemporalHealthIndicator>();

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
          temporal: { status: 'up', message: 'not-yet-bootstrapped' },
        },
        error: {},
        details: {
          application: { status: 'up', message: 'Up and running' },
          temporal: { status: 'up', message: 'not-yet-bootstrapped' },
        },
      });

      // Act
      const result = await target.check();

      // Assert
      expect(mockHealthService.check).toHaveBeenCalled();
      expect(result.status).toBe('ok');
    });

    it('should include the temporal indicator in the indicator list', async () => {
      // Arrange
      mockTemporalIndicator.isHealthy.mockReturnValue({
        temporal: { status: 'up', message: 'not-yet-bootstrapped' },
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
  });
});
