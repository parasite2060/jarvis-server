/**
 * Reads `auto_merge` from the vault's `config.yml`. Dream commit-and-pr
 * activities use this to decide whether to auto-merge the PR they create.
 *
 * Lives in `src/shared/git` (not the config business module) so Temporal
 * activities can call it without crossing a business-module boundary. Mirrors
 * the default + read-failure semantics of GetConfigUseCase (DEFAULT_AUTO_MERGE
 * = true; a missing/unreadable/invalid config.yml falls back to the default).
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as YAML from 'yaml';

export const DEFAULT_AUTO_MERGE = true;

export async function readAutoMergeFromVault(vaultPath: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(path.join(vaultPath, 'config.yml'), 'utf-8');
    const parsed = YAML.parse(raw) as { auto_merge?: unknown } | null;
    if (parsed !== null && typeof parsed === 'object' && typeof parsed.auto_merge === 'boolean') {
      return parsed.auto_merge;
    }
  } catch {
    // Missing or unreadable config — fall back to the default.
  }
  return DEFAULT_AUTO_MERGE;
}
