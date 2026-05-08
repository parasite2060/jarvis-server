/**
 * Vault read tools — shared between extraction + record agents (Story 13.10).
 *
 * Per Adjustment 1 (RESOLVED 2026-05-08): full implementations, not stubs.
 * The agent calls these tools via deepagents' tool harness; each handler
 * resolves vault-relative paths via `safeResolveVaultPath` (Story 13.6/13.7
 * shared util) before reading from disk.
 *
 * # Mirrors Python `app/services/dream_agent.py::_register_base_tools`
 *   - `readFile(path, offset?, limit?)` — full content OR line range slice.
 *   - `grep(pattern, path?)` — recursive regex search; capped at 100 matches.
 *   - `listFiles(path?)` — directory listing.
 *   - `fileInfo(path)` — `path={p} lines={n} chars={n} estimated_tokens={n//4}`.
 *   - `readFrontmatter(path)` — extracts YAML between `---` markers.
 *   - `memuSearch(query, limit?)` — delegates to `IMemuApi.retrieve`.
 *   - `memuCategories()` — hardcoded list (Python parity).
 *
 * # Path discipline
 *   All paths are vault-relative. `safeResolveVaultPath` rejects traversal;
 *   tool returns an Error string (not exception) per Python convention so
 *   the agent can self-correct without crashing the run.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Logger } from '@nestjs/common';
import { safeResolveVaultPath } from 'src/shared/utils/path-validation';
import type { IMemuApi } from 'src/shared/domain/apis/memu-api.interface';

const logger = new Logger('VaultTools');

const GREP_MAX_MATCHES = 100;
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

const HARDCODED_MEMU_CATEGORIES = ['decisions', 'preferences', 'patterns', 'corrections', 'facts', 'concepts', 'connections', 'lessons'];

export interface VaultToolDeps {
  vaultPath: string;
  memuApi: IMemuApi;
}

/**
 * `readFile` tool implementation. Vault-relative path; optional line range
 * via `offset` (1-based line number, inclusive) + `limit` (lines).
 * Mirrors Python `read_vault_file_lines(path, offset, limit)` semantics.
 */
export async function readFileTool(deps: VaultToolDeps, input: { path: string; offset?: number; limit?: number }): Promise<string> {
  const resolved = safeResolveVaultPath(deps.vaultPath, input.path);
  if (resolved === null) {
    return `Error: path '${input.path}' is outside the vault root`;
  }
  let content: string;
  try {
    content = await fs.readFile(resolved, 'utf-8');
  } catch (err) {
    return `Error: failed to read '${input.path}': ${(err as Error).message}`;
  }
  if (input.offset === undefined && input.limit === undefined) {
    return content;
  }
  const lines = content.split('\n');
  const start = Math.max(0, (input.offset ?? 1) - 1);
  const end = input.limit !== undefined ? start + input.limit : lines.length;
  return lines.slice(start, end).join('\n');
}

/**
 * `grep` tool implementation. Recursive regex search rooted at `path`
 * (defaults to vault root). Caps at GREP_MAX_MATCHES (100) per Python.
 * Returns one match per line: `{relativePath}:{lineNumber}:{lineContent}`.
 */
export async function grepTool(deps: VaultToolDeps, input: { pattern: string; path?: string }): Promise<string> {
  const rootRel = input.path ?? '.';
  const resolved = safeResolveVaultPath(deps.vaultPath, rootRel);
  if (resolved === null) {
    return `Error: path '${rootRel}' is outside the vault root`;
  }
  let regex: RegExp;
  try {
    regex = new RegExp(input.pattern);
  } catch (err) {
    return `Error: invalid regex pattern: ${(err as Error).message}`;
  }
  const matches: string[] = [];
  await walkAndMatch(resolved, deps.vaultPath, regex, matches);
  if (matches.length === 0) {
    return '(no matches)';
  }
  if (matches.length > GREP_MAX_MATCHES) {
    return (
      matches.slice(0, GREP_MAX_MATCHES).join('\n') + `\n... ${matches.length - GREP_MAX_MATCHES} more matches truncated (cap=${GREP_MAX_MATCHES})`
    );
  }
  return matches.join('\n');
}

async function walkAndMatch(dirOrFile: string, vaultRoot: string, regex: RegExp, matches: string[]): Promise<void> {
  if (matches.length >= GREP_MAX_MATCHES) return;
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(dirOrFile);
  } catch {
    return;
  }
  if (stat.isFile()) {
    if (matches.length >= GREP_MAX_MATCHES) return;
    let content: string;
    try {
      content = await fs.readFile(dirOrFile, 'utf-8');
    } catch {
      return;
    }
    const lines = content.split('\n');
    const rel = path.relative(vaultRoot, dirOrFile);
    for (let i = 0; i < lines.length; i++) {
      if (matches.length >= GREP_MAX_MATCHES) return;
      const line = lines[i] ?? '';
      if (regex.test(line)) {
        matches.push(`${rel}:${i + 1}:${line}`);
      }
    }
    return;
  }
  if (!stat.isDirectory()) return;
  let entries: string[];
  try {
    entries = await fs.readdir(dirOrFile);
  } catch {
    return;
  }
  for (const entry of entries) {
    // Skip hidden dotfiles and .git
    if (entry.startsWith('.')) continue;
    await walkAndMatch(path.join(dirOrFile, entry), vaultRoot, regex, matches);
    if (matches.length >= GREP_MAX_MATCHES) return;
  }
}

/**
 * `listFiles` tool implementation. Lists directory contents one entry per
 * line. Annotates directories with a trailing `/`.
 */
export async function listFilesTool(deps: VaultToolDeps, input: { path?: string }): Promise<string> {
  const rel = input.path ?? '.';
  const resolved = safeResolveVaultPath(deps.vaultPath, rel);
  if (resolved === null) {
    return `Error: path '${rel}' is outside the vault root`;
  }
  let entries: string[];
  try {
    entries = await fs.readdir(resolved);
  } catch (err) {
    return `Error: failed to list '${rel}': ${(err as Error).message}`;
  }
  const annotated: string[] = [];
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    try {
      const stat = await fs.stat(path.join(resolved, entry));
      annotated.push(stat.isDirectory() ? `${entry}/` : entry);
    } catch {
      // ignore
    }
  }
  return annotated.length === 0 ? '(empty directory)' : annotated.sort().join('\n');
}

/**
 * `fileInfo` tool implementation. Returns
 * `path={p} lines={n} chars={n} estimated_tokens={n//4}` per Python.
 */
export async function fileInfoTool(deps: VaultToolDeps, input: { path: string }): Promise<string> {
  const resolved = safeResolveVaultPath(deps.vaultPath, input.path);
  if (resolved === null) {
    return `Error: path '${input.path}' is outside the vault root`;
  }
  let content: string;
  try {
    content = await fs.readFile(resolved, 'utf-8');
  } catch (err) {
    return `Error: failed to read '${input.path}': ${(err as Error).message}`;
  }
  const lines = content.split('\n').length;
  const chars = content.length;
  const estimatedTokens = Math.floor(chars / 4);
  return `path=${input.path} lines=${lines} chars=${chars} estimated_tokens=${estimatedTokens}`;
}

/**
 * `readFrontmatter` tool implementation. Extracts YAML body between two
 * `---` markers at the top of the file. Returns the YAML body (without
 * fences) or '(no frontmatter)' if none found.
 */
export async function readFrontmatterTool(deps: VaultToolDeps, input: { path: string }): Promise<string> {
  const resolved = safeResolveVaultPath(deps.vaultPath, input.path);
  if (resolved === null) {
    return `Error: path '${input.path}' is outside the vault root`;
  }
  let content: string;
  try {
    content = await fs.readFile(resolved, 'utf-8');
  } catch (err) {
    return `Error: failed to read '${input.path}': ${(err as Error).message}`;
  }
  const match = FRONTMATTER_REGEX.exec(content);
  if (match === null) {
    return '(no frontmatter)';
  }
  return match[1] ?? '';
}

/** `memuSearch` tool — delegates to MemU client (Story 13.4). */
export async function memuSearchTool(deps: VaultToolDeps, input: { query: string; limit?: number }): Promise<string> {
  try {
    const result = await deps.memuApi.retrieve(input.query);
    const memories = result.memories.slice(0, input.limit ?? 10);
    return JSON.stringify(memories);
  } catch (err) {
    logger.warn({ message: 'memuSearch failed', event: 'tools.memuSearch.failed', error: (err as Error).message });
    return `Error: memu retrieve failed: ${(err as Error).message}`;
  }
}

/** `memuCategories` tool — hardcoded list (Python parity). */
export async function memuCategoriesTool(): Promise<string> {
  return JSON.stringify(HARDCODED_MEMU_CATEGORIES);
}
