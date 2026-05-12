import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { ContextCacheService } from '../services/context-cache.service';
import { AssembleContextUseCase } from './assemble-context.usecase';
import { GetContextUseCase } from './get-context.usecase';

const FIXED_NOW = new Date('2026-05-08T13:00:00.123Z');
const FIXED_NOW_PYTHON_ISO = '2026-05-08T13:00:00.123000+00:00';

describe('GetContextUseCase', () => {
  let target: GetContextUseCase;
  let mockAssemble: DeepMocked<AssembleContextUseCase>;
  let mockCache: DeepMocked<ContextCacheService>;
  let logSpy: jest.SpyInstance;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);
    mockAssemble = createMock<AssembleContextUseCase>();
    mockCache = createMock<ContextCacheService>();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        GetContextUseCase,
        { provide: AssembleContextUseCase, useValue: mockAssemble },
        { provide: ContextCacheService, useValue: mockCache },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = moduleRef.get(GetContextUseCase);
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('cache hit — returns cached context with cached:true and DOES NOT call AssembleContextUseCase', async () => {
    mockCache.get.mockResolvedValue({
      soul: 'cached-soul',
      identity: 'cached-identity',
      memory: 'cached-memory',
      recentDailys: [{ label: 'TODAY (2026-05-08)', content: 'cached-today' }],
      decisionsIndex: 'cached-decisions',
      projectsIndex: 'cached-projects',
      patternsIndex: 'cached-patterns',
      templatesIndex: 'cached-templates',
      assembled_at: 'old-stamp',
      health: null,
    });

    const presenter = await target.execute();

    expect(presenter.cached).toBe(true);
    expect(presenter.soul).toBe('cached-soul');
    expect(presenter.identity).toBe('cached-identity');
    expect(presenter.memory).toBe('cached-memory');
    expect(presenter.recentDailys).toEqual([{ label: 'TODAY (2026-05-08)', content: 'cached-today' }]);
    expect(presenter.decisionsIndex).toBe('cached-decisions');
    expect(presenter.projectsIndex).toBe('cached-projects');
    expect(presenter.patternsIndex).toBe('cached-patterns');
    expect(presenter.templatesIndex).toBe('cached-templates');
    expect(presenter.assembled_at).toBe(FIXED_NOW_PYTHON_ISO);
    expect(mockAssemble.execute).not.toHaveBeenCalled();
    expect(mockCache.set).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ event: 'context.cache.hit' }));
  });

  it('cache miss — assembles, persists, returns cached:false and the assembled content', async () => {
    mockCache.get.mockResolvedValue(null);
    mockAssemble.execute.mockResolvedValue({
      soul: 'assembled-soul',
      identity: 'assembled-identity',
      memory: 'assembled-memory',
      recentDailys: [
        { label: 'TODAY (2026-05-08)', content: 'assembled-today' },
        { label: 'YESTERDAY (2026-05-07)', content: 'assembled-yesterday' },
      ],
      decisionsIndex: 'assembled-decisions',
      projectsIndex: 'assembled-projects',
      patternsIndex: 'assembled-patterns',
      templatesIndex: 'assembled-templates',
      assembled_at: FIXED_NOW.toISOString().slice(0, 10),
      health: null,
    });

    const presenter = await target.execute();

    expect(presenter.cached).toBe(false);
    expect(presenter.soul).toBe('assembled-soul');
    expect(presenter.identity).toBe('assembled-identity');
    expect(presenter.memory).toBe('assembled-memory');
    expect(presenter.recentDailys).toEqual([
      { label: 'TODAY (2026-05-08)', content: 'assembled-today' },
      { label: 'YESTERDAY (2026-05-07)', content: 'assembled-yesterday' },
    ]);
    expect(mockAssemble.execute).toHaveBeenCalledTimes(1);
    expect(mockCache.set).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ event: 'context.cache.miss', reason: 'empty' }));
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ event: 'context.cache.set' }));
  });

  it('assembled_at format — Python-ISO microseconds + +00:00', async () => {
    mockCache.get.mockResolvedValue(null);
    mockAssemble.execute.mockResolvedValue({
      soul: null,
      identity: null,
      memory: null,
      recentDailys: [],
      decisionsIndex: null,
      projectsIndex: null,
      patternsIndex: null,
      templatesIndex: null,
      assembled_at: FIXED_NOW.toISOString().slice(0, 10),
      health: null,
    });

    const presenter = await target.execute();

    expect(presenter.assembled_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}\+00:00$/);
  });

  it('assembled_at differs across calls when system time advances', async () => {
    mockCache.get.mockResolvedValue(null);
    mockAssemble.execute.mockResolvedValue({
      soul: null,
      identity: null,
      memory: null,
      recentDailys: [],
      decisionsIndex: null,
      projectsIndex: null,
      patternsIndex: null,
      templatesIndex: null,
      assembled_at: '2026-05-08',
      health: null,
    });

    const first = await target.execute();
    jest.setSystemTime(new Date(FIXED_NOW.getTime() + 1_000));
    const second = await target.execute();

    expect(first.assembled_at).not.toBe(second.assembled_at);
  });

  it('cache hit assembled_at reflects current request time, NOT cache-write time', async () => {
    mockCache.get.mockResolvedValue({
      soul: null,
      identity: null,
      memory: null,
      recentDailys: [],
      decisionsIndex: null,
      projectsIndex: null,
      patternsIndex: null,
      templatesIndex: null,
      assembled_at: '2026-05-01T00:00:00.000000+00:00',
      health: null,
    });
    jest.setSystemTime(new Date('2026-05-08T13:00:00.999Z'));

    const presenter = await target.execute();

    expect(presenter.assembled_at).toBe('2026-05-08T13:00:00.999000+00:00');
  });

  it('returns context string built from structured fields', async () => {
    mockCache.get.mockResolvedValue(null);
    mockAssemble.execute.mockResolvedValue({
      soul: 'soul-content',
      identity: 'identity-content',
      memory: 'memory-content',
      recentDailys: [],
      decisionsIndex: null,
      projectsIndex: null,
      patternsIndex: null,
      templatesIndex: null,
      assembled_at: '2026-05-08',
      health: null,
    });

    const presenter = await target.execute();

    expect(presenter.context).toContain('## SOUL');
    expect(presenter.context).toContain('soul-content');
    expect(presenter.context).toContain('## IDENTITY');
    expect(presenter.context).toContain('identity-content');
  });

  it('returns null structured fields when vault sections are absent', async () => {
    mockCache.get.mockResolvedValue(null);
    mockAssemble.execute.mockResolvedValue({
      soul: null,
      identity: null,
      memory: null,
      recentDailys: [],
      decisionsIndex: null,
      projectsIndex: null,
      patternsIndex: null,
      templatesIndex: null,
      assembled_at: '2026-05-08',
      health: null,
    });

    const presenter = await target.execute();

    expect(presenter.soul).toBeNull();
    expect(presenter.identity).toBeNull();
    expect(presenter.memory).toBeNull();
    expect(presenter.context).toContain('## MEMORY TOOLS');
  });
});
