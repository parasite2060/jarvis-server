/**
 * Unit tests for `WriteFilesActivity` (Story 13.10.5 / Q4 decomposition).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { WriteFilesActivity } from './write-files.activity';
import { AppConfigService } from 'src/shared/config/config.service';
import { FILE_MANIFEST_REPOSITORY, IFileManifestRepository } from 'src/shared/domain/repositories/file-manifest.repository.interface';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';

describe('WriteFilesActivity', () => {
  let target: WriteFilesActivity;
  let mockManifestRepo: DeepMocked<IFileManifestRepository>;
  let mockConfig: DeepMocked<AppConfigService>;

  beforeEach(async () => {
    mockManifestRepo = createMock<IFileManifestRepository>();
    mockConfig = createMock<AppConfigService>();
    Object.defineProperty(mockConfig, 'vaultPath', { configurable: true, get: () => '/tmp/vault-not-real' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WriteFilesActivity,
        { provide: FILE_MANIFEST_REPOSITORY, useValue: mockManifestRepo },
        { provide: AppConfigService, useValue: mockConfig },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(WriteFilesActivity);
  });

  it('returns vault_writes triples and drops the topics folder', async () => {
    // Arrange
    const consolidationJson = {
      memory_md: 'mem',
      daily_summary: 'sum',
      stats: {},
      vault_updates: {
        decisions: [{ filename: 'foo.md', title: 'Foo', summary: 'short', content: 'body', tags: [], action: 'create' }],
        projects: [],
        patterns: [],
        templates: [],
        concepts: [],
        connections: [],
        lessons: [],
        topics: [{ filename: 'should-be-dropped.md', title: 'Topic', summary: 'short', content: 'body', tags: [], action: 'create' }],
      },
    };

    // Act
    const result = await target.writeFiles({
      dream_id: 1,
      source_date_iso: '2026-05-07',
      consolidation_json: consolidationJson,
    });

    // Assert
    const paths = result.vault_writes.map((t) => t.path);
    expect(paths).toContain('MEMORY.md');
    expect(paths).toContain('decisions/foo.md');
    expect(paths.find((p) => p.includes('should-be-dropped'))).toBeUndefined();
  });

  it('throws when memory_md is empty', async () => {
    // Arrange
    const consolidationJson = { memory_md: '', daily_summary: 'd' };

    // Act / Assert
    await expect(target.writeFiles({ dream_id: 1, source_date_iso: '2026-05-07', consolidation_json: consolidationJson })).rejects.toThrow();
  });
});
