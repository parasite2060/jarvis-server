/**
 * Smoke spec for ConfigController (Story 13.10.5 scaffold; Story 13.13
 * functional). Verifies the controller boots via the NestJS DI container
 * and routes delegate to their use cases.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ConfigController } from './config.controller';
import { GetConfigUseCase } from './usecases/get-config.usecase';
import { UpdateConfigUseCase } from './usecases/update-config.usecase';
import { ConfigPresenter } from './models/presenters/config.presenter';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';

describe('ConfigController', () => {
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
    const presenter = new ConfigPresenter(true, '0 20 * * *', '0 20 * * 0', 200);
    mockGetConfig.execute.mockResolvedValue(presenter);

    // Act
    const result = await target.getConfig();

    // Assert
    expect(result).toBe(presenter);
    expect(mockGetConfig.execute).toHaveBeenCalledTimes(1);
  });

  it('delegates PATCH /config to UpdateConfigUseCase with the request body', async () => {
    // Arrange
    const presenter = new ConfigPresenter(true, '0 2 * * *', '0 20 * * 0', 200);
    mockUpdateConfig.execute.mockResolvedValue(presenter);

    // Act
    const result = await target.updateConfig({ deepDreamCron: '0 2 * * *' });

    // Assert
    expect(result).toBe(presenter);
    expect(mockUpdateConfig.execute).toHaveBeenCalledWith({ deepDreamCron: '0 2 * * *' });
  });
});
