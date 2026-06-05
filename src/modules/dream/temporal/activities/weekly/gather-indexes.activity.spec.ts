/**
 * Unit tests for `GatherIndexesActivity` (Story 13.10.5 / Q4 decomposition).
 */
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { GatherIndexesActivity } from './gather-indexes.activity';
import { AppConfigService } from 'src/shared/config/config.service';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';

describe('GatherIndexesActivity', () => {
  let target: GatherIndexesActivity;
  let mockConfig: DeepMocked<AppConfigService>;
  let vaultRoot: string;

  beforeEach(async () => {
    mockConfig = createMock<AppConfigService>();
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weekly-gi-'));
    Object.defineProperty(mockConfig, 'vaultPath', { configurable: true, get: () => vaultRoot });

    const module: TestingModule = await Test.createTestingModule({
      providers: [GatherIndexesActivity, { provide: AppConfigService, useValue: mockConfig }],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(GatherIndexesActivity);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await fs.rm(vaultRoot, { recursive: true, force: true }).catch(() => {});
  });

  it('reads 6 folder _index.md + _guide.md', async () => {
    // Arrange
    for (const folder of ['decisions', 'patterns', 'concepts']) {
      await fs.mkdir(path.join(vaultRoot, folder), { recursive: true });
      await fs.writeFile(path.join(vaultRoot, folder, '_index.md'), `idx-${folder}`);
    }
    await fs.writeFile(path.join(vaultRoot, '_guide.md'), 'guide-body');

    // Act
    const result = await target.gatherIndexes({ dream_id: 1, week_start: '2026-05-04' });

    // Assert
    expect(result.vault_indexes).toEqual({ decisions: 'idx-decisions', patterns: 'idx-patterns', concepts: 'idx-concepts' });
    expect(result.vault_guide).toBe('guide-body');
  });

  it('returns empty vault_guide when missing', async () => {
    // Act
    const result = await target.gatherIndexes({ dream_id: 1, week_start: '2026-05-04' });

    // Assert
    expect(result.vault_guide).toBe('');
    expect(result.vault_indexes).toEqual({});
  });
});
