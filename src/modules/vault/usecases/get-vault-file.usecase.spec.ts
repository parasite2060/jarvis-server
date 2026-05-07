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
});
