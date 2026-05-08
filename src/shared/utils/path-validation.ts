/**
 * Centralized vault path-traversal validation.
 *
 * Originally introduced by Story 13.6 at `src/modules/vault/utils/path-validation.ts`;
 * promoted to `src/shared/utils/` by Story 13.7 / Q3 (b) so shared infrastructure
 * (`GitOpsService`) can reuse it without violating the module-boundary rule
 * (architecture §1.4 principle 8 — shared MUST NOT depend on business modules).
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
 *   - GitOpsService.writeFiles (Story 13.7): throw
 *     `InternalException(GIT_OPS_VAULT_PATH_INVALID)` — defensive validation at
 *     the FS boundary.
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
