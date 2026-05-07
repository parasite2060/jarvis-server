import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { CommandBus } from '@nestjs/cqrs';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { VaultFileNotFoundError } from 'src/shared/common/exceptions/vault-file-not-found.error';
import { GetVaultFileCommand } from 'src/modules/vault/commands/get-vault-file.command';
import { GetSoulUseCase } from './get-soul.usecase';

describe('GetSoulUseCase', () => {
  let target: GetSoulUseCase;
  let mockCommandBus: DeepMocked<CommandBus>;

  beforeEach(async () => {
    mockCommandBus = createMock<CommandBus>();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [GetSoulUseCase, { provide: CommandBus, useValue: mockCommandBus }],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = moduleRef.get(GetSoulUseCase);
  });

  it('happy path — returns presenter with content + file_path', async () => {
    // Arrange
    mockCommandBus.execute.mockResolvedValue({ content: '# SOUL', file_path: 'SOUL.md' });

    // Act
    const presenter = await target.execute();

    // Assert
    expect(presenter).toEqual({ content: '# SOUL', file_path: 'SOUL.md' });
    expect(mockCommandBus.execute).toHaveBeenCalledTimes(1);
    const command = mockCommandBus.execute.mock.calls[0]![0] as GetVaultFileCommand;
    expect(command).toBeInstanceOf(GetVaultFileCommand);
    expect(command.payload).toEqual({ path: 'SOUL.md' });
  });

  it('not-found — throws VaultFileNotFoundError', async () => {
    // Arrange
    mockCommandBus.execute.mockResolvedValue({ content: null, file_path: 'SOUL.md' });

    // Act / Assert
    await expect(target.execute()).rejects.toBeInstanceOf(VaultFileNotFoundError);
  });
});
