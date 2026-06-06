/**
 * Reads `auto_merge` and AI conflict-resolution settings from the vault's
 * `config.yml`. Dream commit-and-pr activities use these to decide whether
 * to auto-merge PRs and whether to invoke AI for rebase conflicts.
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

export const DEFAULT_AI_CONFLICT_RESOLUTION = false;
export const DEFAULT_CONFLICT_ALLOW_GLOBS = [
  'dailys/*',
  'decisions/*',
  'patterns/*',
  'lessons/*',
  'concepts/*',
  'connections/*',
  'projects/*',
  'references/*',
  'reviews/*',
  'topics/*',
  'templates/*',
];
export const DEFAULT_PROTECTED_FILES = ['MEMORY.md', 'SOUL.md', 'IDENTITY.md'];
export const DEFAULT_AUTO_MERGE_RESOLVED = true;

export interface ConflictConfig {
  aiConflictResolution: boolean;
  allowGlobs: string[];
  protectedFiles: string[];
  autoMergeResolved: boolean;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((s) => typeof s === 'string');
}

/**
 * Reads AI conflict-resolution config from the vault's config.yml, mapping:
 * `ai_conflict_resolution` → aiConflictResolution,
 * `ai_conflict_resolution_files` → allowGlobs,
 * `ai_conflict_resolution_protected` → protectedFiles,
 * `ai_conflict_resolution_auto_merge` → autoMergeResolved.
 * Any missing, invalid, or unreadable value falls back to its default.
 */
export async function readConflictConfig(vaultPath: string): Promise<ConflictConfig> {
  let parsed: Record<string, unknown> | null = null;
  try {
    const raw = await fs.readFile(path.join(vaultPath, 'config.yml'), 'utf-8');
    const result = YAML.parse(raw) as unknown;
    if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
      parsed = result as Record<string, unknown>;
    }
  } catch {
    // Missing or unreadable config — fall back to all defaults.
  }

  const aiConflictResolution =
    parsed !== null && typeof parsed['ai_conflict_resolution'] === 'boolean' ? parsed['ai_conflict_resolution'] : DEFAULT_AI_CONFLICT_RESOLUTION;

  const allowGlobs =
    parsed !== null && isStringArray(parsed['ai_conflict_resolution_files']) ? parsed['ai_conflict_resolution_files'] : DEFAULT_CONFLICT_ALLOW_GLOBS;

  const protectedFiles =
    parsed !== null && isStringArray(parsed['ai_conflict_resolution_protected'])
      ? parsed['ai_conflict_resolution_protected']
      : DEFAULT_PROTECTED_FILES;

  const autoMergeResolved =
    parsed !== null && typeof parsed['ai_conflict_resolution_auto_merge'] === 'boolean'
      ? parsed['ai_conflict_resolution_auto_merge']
      : DEFAULT_AUTO_MERGE_RESOLVED;

  return { aiConflictResolution, allowGlobs, protectedFiles, autoMergeResolved };
}
