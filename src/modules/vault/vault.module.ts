/**
 * VaultModule — owns vault file I/O (manifest + file-serving + cross-module
 * `GetVaultFileCommand` for SOUL/IDENTITY/MEMORY reads). Story 13.4 created
 * the read stub; Story 13.5 added max_lines support; Story 13.6 retrofitted
 * with manifest + file-serving controller + central path-validation helper +
 * `IFileManifestRepository` impl + `VaultFileUpdatedEvent`.
 *
 * `WriteVaultFileCommand` is owned by future Stories 13.10 (light dream
 * record agent vault writes) and 13.11 (deep dream Phase 3 vault writes).
 */
import { Module } from '@nestjs/common';
import { CommandHandlers } from './commands/handlers';
import { UseCases } from './usecases';
import { VaultController } from './vault.controller';

@Module({
  controllers: [VaultController],
  providers: [...UseCases, ...CommandHandlers],
})
export class VaultModule {}
