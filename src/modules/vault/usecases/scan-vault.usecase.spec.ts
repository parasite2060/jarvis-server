import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { AppConfigService } from 'src/shared/config/config.service';
import { ScanVaultUseCase, VaultFileInfo } from './scan-vault.usecase';

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

describe('ScanVaultUseCase', () => {
  let target: ScanVaultUseCase;
  let mockConfig: DeepMocked<AppConfigService>;
  let vaultRoot: string;

  beforeEach(async () => {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-vault-scan-'));
    mockConfig = createMock<AppConfigService>();
    Object.defineProperty(mockConfig, 'vaultPath', { get: () => vaultRoot });

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [ScanVaultUseCase, { provide: AppConfigService, useValue: mockConfig }],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = moduleRef.get(ScanVaultUseCase);
  });

  afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true });
  });

  it('happy path — returns SHA-256 hash + size + updatedAt for each .md/.yml/.yaml file', async () => {
    // Arrange
    await fs.writeFile(path.join(vaultRoot, 'SOUL.md'), '# SOUL', 'utf-8');
    await fs.mkdir(path.join(vaultRoot, 'dailys'), { recursive: true });
    await fs.writeFile(path.join(vaultRoot, 'dailys/2026-05-08.md'), '# DAILY', 'utf-8');
    await fs.writeFile(path.join(vaultRoot, 'config.yml'), 'cron: "0 1 * * *"', 'utf-8');
    await fs.writeFile(path.join(vaultRoot, 'note.yaml'), 'tags: []', 'utf-8');

    // Act
    const result = await target.execute();

    // Assert
    expect(result).toHaveLength(4);
    const byPath: Record<string, VaultFileInfo> = Object.fromEntries(result.map((f) => [f.relativePath, f]));
    expect(byPath['SOUL.md']!.contentHash).toBe(sha256('# SOUL'));
    expect(byPath['SOUL.md']!.fileSize).toBe(Buffer.byteLength('# SOUL'));
    expect(byPath['dailys/2026-05-08.md']!.contentHash).toBe(sha256('# DAILY'));
    expect(byPath['config.yml']).toBeDefined();
    expect(byPath['note.yaml']).toBeDefined();
    for (const entry of result) {
      // Date duck-typed check — `instanceof Date` is unreliable across Jest
      // worker boundaries. `getTime()` proves the shape.
      expect(typeof entry.updatedAt.getTime()).toBe('number');
      expect(entry.updatedAt.getTime()).toBeGreaterThan(0);
    }
  });

  it('excludes non-vault extensions (.txt / .js)', async () => {
    // Arrange
    await fs.writeFile(path.join(vaultRoot, 'README.txt'), 'readme', 'utf-8');
    await fs.writeFile(path.join(vaultRoot, 'script.js'), 'code', 'utf-8');
    await fs.writeFile(path.join(vaultRoot, 'SOUL.md'), '# SOUL', 'utf-8');

    // Act
    const result = await target.execute();

    // Assert
    expect(result.map((f) => f.relativePath)).toEqual(['SOUL.md']);
  });

  it('excludes SKIP_DIRS — .git, .backups, node_modules, __pycache__', async () => {
    // Arrange
    await fs.mkdir(path.join(vaultRoot, '.git'), { recursive: true });
    await fs.writeFile(path.join(vaultRoot, '.git/config.md'), 'should-skip', 'utf-8');
    await fs.mkdir(path.join(vaultRoot, '.backups'), { recursive: true });
    await fs.writeFile(path.join(vaultRoot, '.backups/old.md'), 'should-skip', 'utf-8');
    await fs.mkdir(path.join(vaultRoot, 'node_modules/foo'), { recursive: true });
    await fs.writeFile(path.join(vaultRoot, 'node_modules/foo/index.md'), 'should-skip', 'utf-8');
    await fs.mkdir(path.join(vaultRoot, '__pycache__'), { recursive: true });
    await fs.writeFile(path.join(vaultRoot, '__pycache__/bar.md'), 'should-skip', 'utf-8');
    await fs.writeFile(path.join(vaultRoot, 'SOUL.md'), '# SOUL', 'utf-8');

    // Act
    const result = await target.execute();

    // Assert
    expect(result.map((f) => f.relativePath)).toEqual(['SOUL.md']);
  });

  it('excludes hidden files (names starting with `.`)', async () => {
    // Arrange
    await fs.writeFile(path.join(vaultRoot, '.gitignore'), 'node_modules', 'utf-8');
    await fs.writeFile(path.join(vaultRoot, '.DS_Store'), 'mac-junk', 'utf-8');
    await fs.writeFile(path.join(vaultRoot, 'SOUL.md'), '# SOUL', 'utf-8');

    // Act
    const result = await target.execute();

    // Assert
    expect(result.map((f) => f.relativePath)).toEqual(['SOUL.md']);
  });

  it('emits POSIX paths even when path.sep is `\\` (forward slash join)', async () => {
    // Arrange
    await fs.mkdir(path.join(vaultRoot, 'decisions/sub'), { recursive: true });
    await fs.writeFile(path.join(vaultRoot, 'decisions/sub/foo.md'), 'x', 'utf-8');

    // Act
    const result = await target.execute();

    // Assert
    expect(result[0]!.relativePath).toBe('decisions/sub/foo.md');
    expect(result[0]!.relativePath).not.toContain('\\');
  });

  it('empty vault returns empty array', async () => {
    // Arrange — vault root is empty.

    // Act
    const result = await target.execute();

    // Assert
    expect(result).toEqual([]);
  });

  it('case-insensitive extension matching — .MD is included', async () => {
    // Arrange
    await fs.writeFile(path.join(vaultRoot, 'SOUL.MD'), '# SOUL', 'utf-8');

    // Act
    const result = await target.execute();

    // Assert
    expect(result).toHaveLength(1);
  });
});
