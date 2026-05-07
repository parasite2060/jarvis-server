import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { AppConfigService } from 'src/shared/config/config.service';
import { GetVaultFileUseCase } from './get-vault-file.usecase';

describe('GetVaultFileUseCase', () => {
  let target: GetVaultFileUseCase;
  let mockConfig: DeepMocked<AppConfigService>;
  let vaultRoot: string;

  beforeEach(async () => {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-vault-'));
    mockConfig = createMock<AppConfigService>();
    Object.defineProperty(mockConfig, 'vaultPath', { get: () => vaultRoot });

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [GetVaultFileUseCase, { provide: AppConfigService, useValue: mockConfig }],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = moduleRef.get(GetVaultFileUseCase);
  });

  afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true });
  });

  it('happy path — returns content + file_path when file exists', async () => {
    // Arrange
    await fs.writeFile(path.join(vaultRoot, 'SOUL.md'), '# SOUL', 'utf-8');

    // Act
    const result = await target.execute('SOUL.md');

    // Assert
    expect(result).toEqual({ content: '# SOUL', file_path: 'SOUL.md' });
  });

  it('missing file — returns { content: null, file_path }', async () => {
    // Arrange — vault root is empty.

    // Act
    const result = await target.execute('NOTHERE.md');

    // Assert
    expect(result).toEqual({ content: null, file_path: 'NOTHERE.md' });
  });

  it('path traversal blocked — returns { content: null, file_path: <input> }', async () => {
    // Arrange — try to escape the vault root.

    // Act
    const result = await target.execute('../escape.md');

    // Assert
    expect(result.content).toBeNull();
    expect(result.file_path).toBe('../escape.md');
  });

  it('absolute path — treated as path traversal (resolves outside vault root)', async () => {
    // Arrange / Act
    const result = await target.execute('/etc/passwd');

    // Assert
    expect(result.content).toBeNull();
    expect(result.file_path).toBe('/etc/passwd');
  });

  it('directory instead of file — returns { content: null, file_path }', async () => {
    // Arrange
    await fs.mkdir(path.join(vaultRoot, 'subdir'), { recursive: true });

    // Act
    const result = await target.execute('subdir');

    // Assert
    expect(result).toEqual({ content: null, file_path: 'subdir' });
  });

  // Story 13.5 / Q2+Q4 — backward-compatible max_lines extension.
  describe('maxLines truncation (Story 13.5)', () => {
    it('maxLines not provided — returns full content (backward-compat)', async () => {
      // Arrange — file with 5 lines.
      const lines = Array.from({ length: 5 }, (_, i) => `line-${i + 1}`).join('\n');
      await fs.writeFile(path.join(vaultRoot, 'short.md'), lines, 'utf-8');

      // Act
      const result = await target.execute('short.md');

      // Assert
      expect(result.content).toBe(lines);
    });

    it('maxLines=200 with 250-line content — returns exactly 200 lines joined by \\n', async () => {
      // Arrange
      const allLines = Array.from({ length: 250 }, (_, i) => `line-${i + 1}`);
      await fs.writeFile(path.join(vaultRoot, 'big.md'), allLines.join('\n'), 'utf-8');

      // Act
      const result = await target.execute('big.md', 200);

      // Assert
      const expected = allLines.slice(0, 200).join('\n');
      expect(result.content).toBe(expected);
      expect(result.content!.split('\n')).toHaveLength(200);
    });

    it('maxLines=200 with 50-line content — returns full 50 lines (no padding)', async () => {
      // Arrange
      const allLines = Array.from({ length: 50 }, (_, i) => `line-${i + 1}`);
      await fs.writeFile(path.join(vaultRoot, 'small.md'), allLines.join('\n'), 'utf-8');

      // Act
      const result = await target.execute('small.md', 200);

      // Assert
      expect(result.content).toBe(allLines.join('\n'));
      expect(result.content!.split('\n')).toHaveLength(50);
    });
  });
});
