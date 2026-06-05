import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { AppConfigService } from 'src/shared/config/config.service';
import { VaultEndpointFileNotFoundError } from 'src/shared/common/exceptions/vault-endpoint-file-not-found.error';
import { VaultEndpointPathTraversalError } from 'src/shared/common/exceptions/vault-endpoint-path-traversal.error';
import { GetVaultFileByPathUseCase } from './get-vault-file-by-path.usecase';

describe('GetVaultFileByPathUseCase', () => {
  let target: GetVaultFileByPathUseCase;
  let mockConfig: DeepMocked<AppConfigService>;
  let vaultRoot: string;

  beforeEach(async () => {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-vault-fbp-'));
    mockConfig = createMock<AppConfigService>();
    Object.defineProperty(mockConfig, 'vaultPath', { get: () => vaultRoot });

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [GetVaultFileByPathUseCase, { provide: AppConfigService, useValue: mockConfig }],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = moduleRef.get(GetVaultFileByPathUseCase);
  });

  afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true });
  });

  it('happy path — returns presenter with content + filePath + hash + size', async () => {
    // Arrange
    const content = '# Daily 2026-05-08\n\nNotes...';
    await fs.mkdir(path.join(vaultRoot, 'dailys'), { recursive: true });
    await fs.writeFile(path.join(vaultRoot, 'dailys/2026-05-08.md'), content, 'utf-8');

    // Act
    const result = await target.execute('dailys/2026-05-08.md');

    // Assert
    expect(result.content).toBe(content);
    expect(result.filePath).toBe('dailys/2026-05-08.md');
    expect(result.hash).toBe(createHash('sha256').update(Buffer.from(content, 'utf-8')).digest('hex'));
    expect(result.size).toBe(Buffer.byteLength(content));
  });

  it('path traversal — throws VaultEndpointPathTraversalError', async () => {
    // Act / Assert
    await expect(target.execute('../etc/passwd')).rejects.toBeInstanceOf(VaultEndpointPathTraversalError);
  });

  it('absolute path traversal — throws VaultEndpointPathTraversalError', async () => {
    // Act / Assert
    await expect(target.execute('/etc/passwd')).rejects.toBeInstanceOf(VaultEndpointPathTraversalError);
  });

  it('missing file (ENOENT) — throws VaultEndpointFileNotFoundError', async () => {
    // Act / Assert
    await expect(target.execute('NOTHERE.md')).rejects.toBeInstanceOf(VaultEndpointFileNotFoundError);
  });

  it('directory instead of file (EISDIR) — throws VaultEndpointFileNotFoundError', async () => {
    // Arrange
    await fs.mkdir(path.join(vaultRoot, 'subdir'), { recursive: true });

    // Act / Assert
    await expect(target.execute('subdir')).rejects.toBeInstanceOf(VaultEndpointFileNotFoundError);
  });
});
