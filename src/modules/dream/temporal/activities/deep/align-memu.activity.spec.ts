/**
 * Unit tests for `AlignMemuActivity` (Story 13.10.5 / Q4 decomposition).
 */
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { AlignMemuActivity } from './align-memu.activity';
import { AppConfigService } from 'src/shared/config/config.service';
import { MEMU_API, IMemuApi } from 'src/shared/domain/apis/memu-api.interface';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';

describe('AlignMemuActivity', () => {
  let target: AlignMemuActivity;
  let mockMemuApi: DeepMocked<IMemuApi>;
  let mockConfig: DeepMocked<AppConfigService>;
  let vaultPathOverride: string;

  beforeEach(async () => {
    mockMemuApi = createMock<IMemuApi>();
    mockConfig = createMock<AppConfigService>();
    vaultPathOverride = '/tmp/vault-not-real';
    Object.defineProperty(mockConfig, 'vaultPath', { configurable: true, get: () => vaultPathOverride });

    const module: TestingModule = await Test.createTestingModule({
      providers: [AlignMemuActivity, { provide: MEMU_API, useValue: mockMemuApi }, { provide: AppConfigService, useValue: mockConfig }],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(AlignMemuActivity);
  });

  it('runs per-entry MemU memorize calls (one per entry) on a real tmp vault', async () => {
    // Arrange
    vaultPathOverride = await fsp.mkdtemp(path.join(os.tmpdir(), 'jarvis-align-'));
    mockMemuApi.memorize.mockResolvedValue({});

    // Act
    await target.alignMemu({
      dream_id: 1,
      memory_md: '## Strong Patterns\n- foo\n## Decisions\n- bar\n## Facts\n- baz\n',
      source_date_iso: '2026-05-07',
      idempotency_key: 'dream-1',
    });

    // Assert
    expect(mockMemuApi.memorize).toHaveBeenCalledTimes(3);
    await fsp.rm(vaultPathOverride, { recursive: true, force: true });
  });

  it('tolerates per-entry MemU failures (logs + continues)', async () => {
    // Arrange
    vaultPathOverride = await fsp.mkdtemp(path.join(os.tmpdir(), 'jarvis-align-'));
    mockMemuApi.memorize.mockRejectedValueOnce(new Error('memu transient')).mockResolvedValue({});

    // Act
    await target.alignMemu({
      dream_id: 1,
      memory_md: '## Decisions\n- foo\n- bar\n',
      source_date_iso: '2026-05-07',
      idempotency_key: 'dream-1',
    });

    // Assert
    expect(mockMemuApi.memorize).toHaveBeenCalledTimes(2);
    await fsp.rm(vaultPathOverride, { recursive: true, force: true });
  });
});
