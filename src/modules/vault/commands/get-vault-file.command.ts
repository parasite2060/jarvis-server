/**
 * Cross-module read-vault-file Command (Story 13.4 / Q1; extended Story 13.5 / Q2+Q4).
 *
 * Owned by `vault`; consumed by `memory` (GetSoul/GetIdentity/GetMemoryFile)
 * and `context` (AssembleContextUseCase) via `CommandBus.execute(...)`. Commands
 * are DTOs (data, not behaviour) — exporting the class across modules is the
 * canonical CQRS pattern (architecture.md §1.4 / §8.9).
 *
 * Story 13.5 extension (backward-compatible): payload now accepts an optional
 * `max_lines?: number`. When provided AND content is non-null, the use case
 * truncates content to the first `max_lines` lines (mirrors Python
 * `read_vault_file_lines` at `memory_files.py:62-69` — `splitlines()[:max_lines]`
 * joined with `\n`). Existing 13.4 callers pass no `max_lines` → behaviour
 * unchanged.
 */
export class GetVaultFileCommand {
  constructor(public readonly payload: { path: string; max_lines?: number }) {}
}

export interface GetVaultFileResult {
  content: string | null;
  file_path: string;
}
