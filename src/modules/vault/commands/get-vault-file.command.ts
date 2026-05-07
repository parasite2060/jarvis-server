/**
 * Cross-module read-vault-file Command (Story 13.4 / Q1).
 *
 * Owned by `vault`; consumed by `memory` (GetSoul/GetIdentity/GetMemoryFile)
 * via `CommandBus.execute(...)`. Commands are DTOs (data, not behaviour) — exporting
 * the class across modules is the canonical CQRS pattern (architecture.md §1.4 / §8.9).
 */
export class GetVaultFileCommand {
  constructor(public readonly payload: { path: string }) {}
}

export interface GetVaultFileResult {
  content: string | null;
  file_path: string;
}
