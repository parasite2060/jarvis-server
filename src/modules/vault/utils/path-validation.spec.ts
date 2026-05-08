import * as path from 'node:path';
import { safeResolveVaultPath } from './path-validation';

describe('safeResolveVaultPath', () => {
  const vaultRoot = '/var/lib/jarvis/ai-memory';

  it('within-vault relative path — returns absolute resolved path', () => {
    // Act
    const result = safeResolveVaultPath(vaultRoot, 'SOUL.md');

    // Assert
    expect(result).toBe(path.resolve(vaultRoot, 'SOUL.md'));
  });

  it('nested within-vault path — returns absolute resolved path', () => {
    // Act
    const result = safeResolveVaultPath(vaultRoot, 'dailys/2026-05-08.md');

    // Assert
    expect(result).toBe(path.resolve(vaultRoot, 'dailys/2026-05-08.md'));
  });

  it('parent-traversal path — returns null', () => {
    // Act
    const result = safeResolveVaultPath(vaultRoot, '../etc/passwd');

    // Assert
    expect(result).toBeNull();
  });

  it('nested-then-traversal path — returns null', () => {
    // Act
    const result = safeResolveVaultPath(vaultRoot, 'dailys/../../etc/passwd');

    // Assert
    expect(result).toBeNull();
  });

  it('absolute path escaping root — returns null', () => {
    // Act
    const result = safeResolveVaultPath(vaultRoot, '/etc/passwd');

    // Assert
    expect(result).toBeNull();
  });

  it('empty string — returns the resolved vault root itself (mirrors Python safe_resolve(root, ""))', () => {
    // Act
    const result = safeResolveVaultPath(vaultRoot, '');

    // Assert — Python's safe_resolve returns the root in this edge case.
    expect(result).toBe(path.resolve(vaultRoot));
  });
});
