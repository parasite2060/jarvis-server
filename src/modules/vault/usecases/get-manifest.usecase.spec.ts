import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { FILE_MANIFEST_REPOSITORY, IFileManifestRepository } from 'src/shared/domain/repositories/file-manifest.repository.interface';
import { BuildManifestUseCase } from './build-manifest.usecase';
import { GetManifestUseCase } from './get-manifest.usecase';
import { VaultFileInfo } from './scan-vault.usecase';

function makeFile(relativePath: string, contentHash: string): VaultFileInfo {
  return {
    relativePath,
    contentHash,
    fileSize: 100,
    updatedAt: new Date('2026-05-08T13:00:00.000Z'),
  };
}

describe('GetManifestUseCase', () => {
  let target: GetManifestUseCase;
  let mockBuild: DeepMocked<BuildManifestUseCase>;
  let mockRepo: DeepMocked<IFileManifestRepository>;

  beforeEach(async () => {
    mockBuild = createMock<BuildManifestUseCase>();
    mockRepo = createMock<IFileManifestRepository>();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        GetManifestUseCase,
        { provide: BuildManifestUseCase, useValue: mockBuild },
        { provide: FILE_MANIFEST_REPOSITORY, useValue: mockRepo },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = moduleRef.get(GetManifestUseCase);
  });

  it('happy path — populates presenter with camelCase fields and triggers fire-and-forget DB sync', async () => {
    // Arrange
    const files = [makeFile('SOUL.md', 'h-soul'), makeFile('IDENTITY.md', 'h-identity')];
    mockBuild.execute.mockResolvedValue({
      files,
      manifestHash: 'mh1',
      generatedAt: new Date('2026-05-08T13:00:00.000Z'),
    });
    mockRepo.syncFromManifest.mockResolvedValue();

    // Act
    const presenter = await target.execute();

    // Drain the microtask queue so the fire-and-forget call resolves.
    await Promise.resolve();

    // Assert
    expect(presenter.manifestHash).toBe('mh1');
    expect(presenter.fileCount).toBe(2);
    expect(presenter.generatedAt).toBe('2026-05-08T13:00:00.000000+00:00');
    expect(presenter.files).toHaveLength(2);
    expect(presenter.files[0]!.path).toBe('SOUL.md');
    expect(presenter.files[0]!.hash).toBe('h-soul');
    expect(presenter.files[0]!.size).toBe(100);
    expect(presenter.files[0]!.updatedAt).toBe('2026-05-08T13:00:00.000000+00:00');
    // Fire-and-forget: dispatched once but the use case did NOT await it.
    expect(mockRepo.syncFromManifest).toHaveBeenCalledTimes(1);
    expect(mockRepo.syncFromManifest).toHaveBeenCalledWith(files);
  });

  it('use case stays thin — repo owns soft-fail; use case dispatches without awaiting', async () => {
    // Arrange — production contract: the repo's `syncFromManifest` resolves
    // even when its body would throw (try/catch wraps the diff body inside
    // the repo per Q6). The use case relies on this contract.
    mockBuild.execute.mockResolvedValue({ files: [], manifestHash: 'empty-h', generatedAt: new Date() });
    let dispatched = false;
    mockRepo.syncFromManifest.mockImplementation(async () => {
      dispatched = true;
    });

    // Act
    const presenter = await target.execute();

    // Assert — presenter completed; dispatch happened.
    expect(presenter.fileCount).toBe(0);
    await Promise.resolve();
    expect(dispatched).toBe(true);
  });
});
