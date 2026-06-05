/**
 * Unit tests for `GatherDailysActivity` (Story 13.10.5 / Q4 decomposition).
 * AAA + `@golevelup/ts-jest` `createMock` for every constructor dependency.
 */
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ApplicationFailure } from '@temporalio/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { GatherDailysActivity } from './gather-dailys.activity';
import { AppConfigService } from 'src/shared/config/config.service';
import { DBConnections } from 'src/shared/postgres/utils/constaint';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { InternalException } from 'src/shared/common/models/exception';

describe('GatherDailysActivity', () => {
  let target: GatherDailysActivity;
  let mockDataSource: DeepMocked<DataSource>;
  let mockConfig: DeepMocked<AppConfigService>;
  let vaultRoot: string;

  beforeEach(async () => {
    mockDataSource = createMock<DataSource>();
    mockConfig = createMock<AppConfigService>();
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weekly-gd-'));
    Object.defineProperty(mockConfig, 'vaultPath', { configurable: true, get: () => vaultRoot });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GatherDailysActivity,
        { provide: getDataSourceToken(DBConnections.INTERNAL), useValue: mockDataSource },
        { provide: AppConfigService, useValue: mockConfig },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(GatherDailysActivity);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await fs.rm(vaultRoot, { recursive: true, force: true }).catch(() => {});
  });

  it('echoes payload dream_id, reads 7 dailys, returns daily_logs map', async () => {
    // Arrange — dream row is created upstream (B-03), activity echoes payload.dream_id.
    const dailysDir = path.join(vaultRoot, 'dailys');
    await fs.mkdir(dailysDir, { recursive: true });
    await fs.writeFile(path.join(dailysDir, '2026-05-04.md'), 'Mon');
    await fs.writeFile(path.join(dailysDir, '2026-05-06.md'), 'Wed');

    // Act
    const result = await target.gatherDailys({ week_start: '2026-05-04', trigger: 'auto', dream_id: 42 });

    // Assert
    expect(result.dream_id).toBe(42);
    expect(result.week_start).toBe('2026-05-04');
    expect(result.daily_logs).toEqual({ '2026-05-04': 'Mon', '2026-05-06': 'Wed' });
    expect(mockDataSource.transaction).not.toHaveBeenCalled();
  });

  it('echoes the dream_id from the payload', async () => {
    // Arrange
    const dailysDir = path.join(vaultRoot, 'dailys');
    await fs.mkdir(dailysDir, { recursive: true });
    await fs.writeFile(path.join(dailysDir, '2026-05-04.md'), 'Mon');

    // Act
    const result = await target.gatherDailys({ week_start: '2026-05-04', dream_id: 99 });

    // Assert
    expect(result.dream_id).toBe(99);
    expect(mockDataSource.transaction).not.toHaveBeenCalled();
  });

  it('raises ApplicationFailure.nonRetryable on empty week (Q5)', async () => {
    // Arrange — no dailys/ directory; dream insert succeeds.
    const fakeDream = { id: 7 };
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    };
    const repo = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      create: jest.fn().mockReturnValue(fakeDream),
      save: jest.fn().mockResolvedValue(fakeDream),
    };
    mockDataSource.transaction.mockImplementation(async (cb: unknown) => {
      return (cb as (m: unknown) => Promise<unknown>)({ getRepository: jest.fn().mockReturnValue(repo) });
    });

    // Act + Assert
    await expect(target.gatherDailys({ week_start: '2026-05-04', dream_id: 1 })).rejects.toBeInstanceOf(ApplicationFailure);
  });

  it('throws on invalid week_start ISO date', async () => {
    // Arrange
    const fakeDream = { id: 8 };
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    };
    const repo = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      create: jest.fn().mockReturnValue(fakeDream),
      save: jest.fn().mockResolvedValue(fakeDream),
    };
    mockDataSource.transaction.mockImplementation(async (cb: unknown) => {
      return (cb as (m: unknown) => Promise<unknown>)({ getRepository: jest.fn().mockReturnValue(repo) });
    });

    // Act + Assert
    await expect(target.gatherDailys({ week_start: 'not-a-date', dream_id: 1 })).rejects.toBeInstanceOf(InternalException);
  });
});
