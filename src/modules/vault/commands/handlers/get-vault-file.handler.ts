/**
 * Cross-module CommandBus handler for `GetVaultFileCommand` (Story 13.4 / Q1).
 *
 * Forwards to `GetVaultFileUseCase` — keeps the use case framework-free and the
 * handler thin (CQRS pattern per app-design §1.4 / §8.9).
 */
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { GetVaultFileCommand, GetVaultFileResult } from '../get-vault-file.command';
import { GetVaultFileUseCase } from '../../usecases/get-vault-file.usecase';

@CommandHandler(GetVaultFileCommand)
export class GetVaultFileHandler implements ICommandHandler<GetVaultFileCommand, GetVaultFileResult> {
  constructor(private readonly usecase: GetVaultFileUseCase) {}

  async execute(command: GetVaultFileCommand): Promise<GetVaultFileResult> {
    return this.usecase.execute(command.payload.path);
  }
}
