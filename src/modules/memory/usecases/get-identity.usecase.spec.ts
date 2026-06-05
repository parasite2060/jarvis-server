import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { CommandBus } from '@nestjs/cqrs';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { VaultFileNotFoundError } from 'src/shared/common/exceptions/vault-file-not-found.error';
import { GetVaultFileCommand } from 'src/modules/vault/commands/get-vault-file.command';
import { GetIdentityUseCase } from './get-identity.usecase';

describe('GetIdentityUseCase', () => {
  let target: GetIdentityUseCase;
  let mockCommandBus: DeepMocked<CommandBus>;

  beforeEach(async () => {
    mockCommandBus = createMock<CommandBus>();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [GetIdentityUseCase, { provide: CommandBus, useValue: mockCommandBus }],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = moduleRef.get(GetIdentityUseCase);
  });

  it('happy path — dispatches IDENTITY.md and returns presenter', async () => {
    // Arrange
    mockCommandBus.execute.mockResolvedValue({ content: '# IDENTITY', file_path: 'IDENTITY.md' });

    // Act
    const presenter = await target.execute();

    // Assert
    expect(presenter).toEqual({ content: '# IDENTITY', file_path: 'IDENTITY.md' });
    const command = mockCommandBus.execute.mock.calls[0]![0] as GetVaultFileCommand;
    expect(command.payload).toEqual({ path: 'IDENTITY.md' });
  });

  it('not-found — throws VaultFileNotFoundError', async () => {
    // Arrange
    mockCommandBus.execute.mockResolvedValue({ content: null, file_path: 'IDENTITY.md' });

    // Act / Assert
    await expect(target.execute()).rejects.toBeInstanceOf(VaultFileNotFoundError);
  });
});
