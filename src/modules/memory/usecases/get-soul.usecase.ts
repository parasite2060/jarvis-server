import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { VaultFileNotFoundError } from 'src/shared/common/exceptions/vault-file-not-found.error';
import { GetVaultFileCommand, GetVaultFileResult } from 'src/modules/vault/commands/get-vault-file.command';
import { FileContentPresenter } from '../models/presenters/file-content.presenter';

const SOUL_PATH = 'SOUL.md';

@Injectable()
export class GetSoulUseCase {
  constructor(private readonly commandBus: CommandBus) {}

  async execute(): Promise<FileContentPresenter> {
    const result: GetVaultFileResult = await this.commandBus.execute(new GetVaultFileCommand({ path: SOUL_PATH }));
    if (result.content === null) {
      throw new VaultFileNotFoundError(SOUL_PATH);
    }
    return new FileContentPresenter(result.content, result.file_path);
  }
}
