// Stub for Story 13.4 — full module owned by Story 13.6 (manifest + file-serving endpoints + path traversal validation).
import { Module } from '@nestjs/common';
import { CommandHandlers } from './commands/handlers';
import { UseCases } from './usecases';

@Module({
  providers: [...UseCases, ...CommandHandlers],
})
export class VaultModule {}
