import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { HealthCheckService, MongooseHealthIndicator, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { RedisHealthIndicator, RedisToken } from '@nestjs-redis/kit';

describe('HealthController', () => {
  let target: HealthController;
  let mockHealthService: DeepMocked<HealthCheckService>;
  let mockRedisHealthIndicator: DeepMocked<RedisHealthIndicator>;

  beforeEach(async () => {
    mockHealthService = createMock<HealthCheckService>();
    mockRedisHealthIndicator = createMock<RedisHealthIndicator>();

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
        },
        error: {},
        details: {
          application: { status: 'up', message: 'Up and running' },
        },
      });

      // Act
      const result = await target.check();

      // Assert
      expect(mockHealthService.check).toHaveBeenCalled();
      expect(result.status).toBe('ok');
    });
  });
});
