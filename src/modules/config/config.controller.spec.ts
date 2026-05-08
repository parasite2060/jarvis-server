/**
 * Smoke spec for ConfigController (Story 13.10.5 scaffold).
 *
 * Functional behaviour wired in Story 13.13. This spec only verifies the
 * controller boots via the NestJS DI container with both placeholder use
 * cases injected — guards against module-wiring regressions.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ConfigController } from './config.controller';
import { GetConfigUseCase } from './usecases/get-config.usecase';
import { UpdateConfigUseCase } from './usecases/update-config.usecase';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';

describe('ConfigController (scaffold)', () => {
  let target: ConfigController;
  let mockGetConfig: DeepMocked<GetConfigUseCase>;
  let mockUpdateConfig: DeepMocked<UpdateConfigUseCase>;

  beforeEach(async () => {
    mockGetConfig = createMock<GetConfigUseCase>();
    mockUpdateConfig = createMock<UpdateConfigUseCase>();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConfigController],
      providers: [
        { provide: GetConfigUseCase, useValue: mockGetConfig },
        { provide: UpdateConfigUseCase, useValue: mockUpdateConfig },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(ConfigController);
  });

  it('delegates GET /config to GetConfigUseCase', async () => {
    // Arrange
    mockGetConfig.execute.mockResolvedValue({ scaffold: true });

    // Act
    const result = await target.getConfig();

    // Assert
    expect(result).toEqual({ scaffold: true });
    expect(mockGetConfig.execute).toHaveBeenCalledTimes(1);
  });

  it('delegates PATCH /config to UpdateConfigUseCase with the request body', async () => {
    // Arrange
    mockUpdateConfig.execute.mockResolvedValue({ ok: true });

    // Act
    const result = await target.updateConfig({ deepDreamCron: '0 2 * * *' });

    // Assert
    expect(result).toEqual({ ok: true });
    expect(mockUpdateConfig.execute).toHaveBeenCalledWith({ deepDreamCron: '0 2 * * *' });
  });
});
