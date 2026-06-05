import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { CommandBus } from '@nestjs/cqrs';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { VaultFileNotFoundError } from 'src/shared/common/exceptions/vault-file-not-found.error';
import { GetVaultFileCommand } from 'src/modules/vault/commands/get-vault-file.command';
import { GetMemoryFileUseCase } from './get-memory-file.usecase';

describe('GetMemoryFileUseCase', () => {
  let target: GetMemoryFileUseCase;
  let mockCommandBus: DeepMocked<CommandBus>;

  beforeEach(async () => {
    mockCommandBus = createMock<CommandBus>();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [GetMemoryFileUseCase, { provide: CommandBus, useValue: mockCommandBus }],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = moduleRef.get(GetMemoryFileUseCase);
  });

  it('happy path — dispatches MEMORY.md and returns presenter', async () => {
    // Arrange
    mockCommandBus.execute.mockResolvedValue({ content: '# MEMORY', file_path: 'MEMORY.md' });

    // Act
    const presenter = await target.execute();

    // Assert
    expect(presenter).toEqual({ content: '# MEMORY', file_path: 'MEMORY.md' });
    const command = mockCommandBus.execute.mock.calls[0]![0] as GetVaultFileCommand;
    expect(command.payload).toEqual({ path: 'MEMORY.md' });
  });

  it('not-found — throws VaultFileNotFoundError', async () => {
    // Arrange
    mockCommandBus.execute.mockResolvedValue({ content: null, file_path: 'MEMORY.md' });

    // Act / Assert
    await expect(target.execute()).rejects.toBeInstanceOf(VaultFileNotFoundError);
  });
});
