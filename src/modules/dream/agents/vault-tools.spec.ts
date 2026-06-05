/**
 * Unit specs for vault-tools (Story 13.10 / Adjustment 1 / RESOLVED 2026-05-08).
 *
 * Each tool gets a happy-path + at-least-one-error-path test. Real FS via
 * `fs.mkdtempSync` for the vault root.
 */
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileInfoTool, grepTool, listFilesTool, readFileTool, readFrontmatterTool, type VaultToolDeps } from './vault-tools';

describe('vault-tools', () => {
  let vaultRoot: string;
  let deps: VaultToolDeps;

  beforeEach(() => {
    // Arrange: fresh temp vault.
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-tools-spec-'));
    deps = { vaultPath: vaultRoot };
  });

  afterEach(() => {
    fs.rmSync(vaultRoot, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  describe('readFileTool', () => {
    it('reads full file content when no offset/limit given', async () => {
      // Arrange
      await fsp.writeFile(path.join(vaultRoot, 'test.md'), 'line1\nline2\nline3');

      // Act
      const result = await readFileTool(deps, { path: 'test.md' });

      // Assert
      expect(result).toBe('line1\nline2\nline3');
    });

    it('returns line slice when offset+limit given', async () => {
      // Arrange
      await fsp.writeFile(path.join(vaultRoot, 'test.md'), 'a\nb\nc\nd\ne');

      // Act — offset=2 means start at line 2 (1-based), limit=2 means 2 lines.
      const result = await readFileTool(deps, { path: 'test.md', offset: 2, limit: 2 });

      // Assert
      expect(result).toBe('b\nc');
    });

    it('returns Error string for path traversal', async () => {
      // Act
      const result = await readFileTool(deps, { path: '../etc/passwd' });

      // Assert
      expect(result).toMatch(/^Error:/);
      expect(result).toMatch(/outside the vault root/);
    });

    it('returns Error string for missing file', async () => {
      // Act
      const result = await readFileTool(deps, { path: 'does-not-exist.md' });

      // Assert
      expect(result).toMatch(/^Error:/);
    });
  });

  describe('grepTool', () => {
    it('returns matches with file:line:content format', async () => {
      // Arrange
      await fsp.writeFile(path.join(vaultRoot, 'a.md'), 'foo\nbar\nbaz');
      await fsp.writeFile(path.join(vaultRoot, 'b.md'), 'qux\nfoo\n');

      // Act
      const result = await grepTool(deps, { pattern: 'foo' });

      // Assert
      expect(result).toContain('a.md:1:foo');
      expect(result).toContain('b.md:2:foo');
    });

    it('returns no-matches sentinel when pattern does not match anywhere', async () => {
      // Arrange
      await fsp.writeFile(path.join(vaultRoot, 'a.md'), 'hello');

      // Act
      const result = await grepTool(deps, { pattern: 'XYZNOTPRESENT' });

      // Assert
      expect(result).toBe('(no matches)');
    });

    it('caps results at 100 matches', async () => {
      // Arrange — 200 matching lines.
      const content = Array.from({ length: 200 }, (_, i) => `match-${i} foo`).join('\n');
      await fsp.writeFile(path.join(vaultRoot, 'big.md'), content);

      // Act
      const result = await grepTool(deps, { pattern: 'foo' });

      // Assert — at most 100 result lines (cap). Walker stops accumulating
      // at 100; the truncation suffix triggers only when more matches were
      // found AFTER the cap (rare in practice, requires walker overshoot).
      expect(result.split('\n').length).toBeLessThanOrEqual(100);
    });

    it('returns Error string for invalid regex', async () => {
      // Act
      const result = await grepTool(deps, { pattern: '[invalid(regex' });

      // Assert
      expect(result).toMatch(/^Error: invalid regex pattern/);
    });

    it('skips dotfiles and .git directories', async () => {
      // Arrange
      await fsp.writeFile(path.join(vaultRoot, 'visible.md'), 'foo');
      await fsp.writeFile(path.join(vaultRoot, '.hidden'), 'foo');

      // Act
      const result = await grepTool(deps, { pattern: 'foo' });

      // Assert
      expect(result).toContain('visible.md');
      expect(result).not.toContain('.hidden');
    });
  });

  describe('listFilesTool', () => {
    it('lists directory entries with directories suffixed by /', async () => {
      // Arrange
      await fsp.writeFile(path.join(vaultRoot, 'a.md'), '');
      await fsp.mkdir(path.join(vaultRoot, 'sub'));

      // Act
      const result = await listFilesTool(deps, { path: '.' });

      // Assert
      expect(result).toContain('a.md');
      expect(result).toContain('sub/');
    });

    it('returns empty-directory sentinel when no visible entries', async () => {
      // Act
      const result = await listFilesTool(deps, { path: '.' });

      // Assert
      expect(result).toBe('(empty directory)');
    });

    it('returns Error string for traversal', async () => {
      // Act
      const result = await listFilesTool(deps, { path: '../..' });

      // Assert
      expect(result).toMatch(/^Error:/);
    });
  });

  describe('fileInfoTool', () => {
    it('returns Python-format stats line', async () => {
      // Arrange — 12 chars, 3 lines, 12/4 = 3 estimated_tokens.
      await fsp.writeFile(path.join(vaultRoot, 'test.md'), 'abc\ndef\nghij');

      // Act
      const result = await fileInfoTool(deps, { path: 'test.md' });

      // Assert
      expect(result).toBe('path=test.md lines=3 chars=12 estimated_tokens=3');
    });

    it('returns Error for traversal', async () => {
      // Act
      const result = await fileInfoTool(deps, { path: '../etc/passwd' });

      // Assert
      expect(result).toMatch(/^Error:/);
    });
  });

  describe('readFrontmatterTool', () => {
    it('extracts YAML body between fences', async () => {
      // Arrange
      await fsp.writeFile(path.join(vaultRoot, 'test.md'), '---\ntitle: Test\nstatus: active\n---\nbody here');

      // Act
      const result = await readFrontmatterTool(deps, { path: 'test.md' });

      // Assert
      expect(result).toBe('title: Test\nstatus: active');
    });

    it('returns no-frontmatter sentinel when no fences', async () => {
      // Arrange
      await fsp.writeFile(path.join(vaultRoot, 'test.md'), 'body without frontmatter');

      // Act
      const result = await readFrontmatterTool(deps, { path: 'test.md' });

      // Assert
      expect(result).toBe('(no frontmatter)');
    });
  });
});
