import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { createHash } from 'node:crypto';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { BuildManifestUseCase } from './build-manifest.usecase';
import { ScanVaultUseCase, VaultFileInfo } from './scan-vault.usecase';

function makeFile(relativePath: string, contentHash: string): VaultFileInfo {
  return {
    relativePath,
    contentHash,
    fileSize: 10,
    updatedAt: new Date('2026-05-08T13:00:00.000Z'),
  };
}

describe('BuildManifestUseCase', () => {
  let target: BuildManifestUseCase;
  let mockScanVault: DeepMocked<ScanVaultUseCase>;

  beforeEach(async () => {
    mockScanVault = createMock<ScanVaultUseCase>();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [BuildManifestUseCase, { provide: ScanVaultUseCase, useValue: mockScanVault }],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = moduleRef.get(BuildManifestUseCase);
  });

  it('happy path — manifestHash is sha256 of sorted "path:hash" entries joined by \\n', async () => {
    // Arrange
    mockScanVault.execute.mockResolvedValue([makeFile('a.md', 'h-a'), makeFile('b.md', 'h-b'), makeFile('c.md', 'h-c')]);

    // Act
    const result = await target.execute();

    // Assert
    const expectedCombined = ['a.md:h-a', 'b.md:h-b', 'c.md:h-c'].join('\n');
    const expectedHash = createHash('sha256').update(expectedCombined, 'utf8').digest('hex');
    expect(result.manifestHash).toBe(expectedHash);
    expect(result.files).toHaveLength(3);
    expect(result.generatedAt).toBeInstanceOf(Date);
  });

  it('manifestHash deterministic across walk orders — same files in different order produce same hash', async () => {
    // Arrange — first run with order A,B,C
    mockScanVault.execute.mockResolvedValueOnce([makeFile('a.md', 'h-a'), makeFile('b.md', 'h-b'), makeFile('c.md', 'h-c')]);
    const first = await target.execute();

    // Arrange — second run with order C,A,B
    mockScanVault.execute.mockResolvedValueOnce([makeFile('c.md', 'h-c'), makeFile('a.md', 'h-a'), makeFile('b.md', 'h-b')]);
    const second = await target.execute();

    // Assert
    expect(first.manifestHash).toBe(second.manifestHash);
  });

  it('empty file list — manifestHash is sha256 of empty string', async () => {
    // Arrange
    mockScanVault.execute.mockResolvedValue([]);

    // Act
    const result = await target.execute();

    // Assert
    expect(result.manifestHash).toBe(createHash('sha256').update('', 'utf8').digest('hex'));
    expect(result.files).toEqual([]);
  });

  it('preserves scan walk order in returned files (sort only applies to hash)', async () => {
    // Arrange — scan returns C, A, B (NOT alphabetical).
    mockScanVault.execute.mockResolvedValue([makeFile('c.md', 'h-c'), makeFile('a.md', 'h-a'), makeFile('b.md', 'h-b')]);

    // Act
    const result = await target.execute();

    // Assert
    expect(result.files.map((f) => f.relativePath)).toEqual(['c.md', 'a.md', 'b.md']);
  });
});
