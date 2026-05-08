/**
 * Centralized vault path-traversal validation — Story 13.6 / Q3.
 *
 * Mirrors Python `app/services/memory_files.py :: safe_resolve(repo_root, relative_path)`.
 * Resolves the candidate path and returns it ONLY if it remains within
 * `vaultRoot`. Returns `null` for any traversal attempt (`..`, absolute paths
 * escaping the root, etc.).
 *
 * Caller decides 404 (file not found) vs 400 (traversal blocked) vs silent
 * skip based on context:
 *   - SOUL/IDENTITY/MEMORY hardcoded reads (Story 13.4): log + return null
 *     content (silent skip — caller distinguishes via the vault.readFile.* event).
 *   - GET /memory/files/{path} (Story 13.6): throw VaultEndpointPathTraversalError
 *     → HTTP 400 (matches Python `files.py:91-101`).
 *
 * Replaces Story 13.4's inline `isWithin()` helper. Behaviour-preserving — same
 * null-on-traversal semantic.
 */
import * as path from 'node:path';

export function safeResolveVaultPath(vaultRoot: string, relativePath: string): string | null {
  const root = path.resolve(vaultRoot);
  const candidate = path.resolve(root, relativePath);
  const rel = path.relative(root, candidate);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    return candidate;
  }
  return null;
}
