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
    // Arrange
    mockCache.get.mockResolvedValue({ context: 'cached-content', assembled_at: 'old-stamp' });

    // Act
    const presenter = await target.execute();

    // Assert
    expect(presenter.context).toBe('cached-content');
    expect(presenter.cached).toBe(true);
    expect(presenter.assembled_at).toBe(FIXED_NOW_PYTHON_ISO);
    expect(mockAssemble.execute).not.toHaveBeenCalled();
    expect(mockCache.set).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ event: 'context.cache.hit' }));
  });

  it('cache miss — assembles, persists with TTL, returns cached:false and the assembled content', async () => {
    // Arrange
    mockCache.get.mockResolvedValue(null);
    mockAssemble.execute.mockResolvedValue('assembled-content');

    // Act
    const presenter = await target.execute();

    // Assert
    expect(presenter.context).toBe('assembled-content');
    expect(presenter.cached).toBe(false);
    expect(presenter.assembled_at).toBe(FIXED_NOW_PYTHON_ISO);
    expect(mockAssemble.execute).toHaveBeenCalledTimes(1);
    expect(mockCache.set).toHaveBeenCalledWith('assembled-content', FIXED_NOW_PYTHON_ISO);
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ event: 'context.cache.miss', reason: 'empty' }));
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ event: 'context.cache.set' }));
  });

  it('assembled_at format — Python-ISO microseconds + +00:00 (Q8 binding)', async () => {
    // Arrange
    mockCache.get.mockResolvedValue(null);
    mockAssemble.execute.mockResolvedValue('x');

    // Act
    const presenter = await target.execute();

    // Assert
    expect(presenter.assembled_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}\+00:00$/);
  });

  it('assembled_at differs across calls when system time advances', async () => {
    // Arrange
    mockCache.get.mockResolvedValue(null);
    mockAssemble.execute.mockResolvedValue('x');

    // Act
    const first = await target.execute();
    jest.setSystemTime(new Date(FIXED_NOW.getTime() + 1_000));
    const second = await target.execute();

    // Assert
    expect(first.assembled_at).not.toBe(second.assembled_at);
  });

  it('cache hit assembled_at reflects current request time, NOT cache-write time', async () => {
    // Arrange — cached row has an old timestamp baked in.
    mockCache.get.mockResolvedValue({ context: 'x', assembled_at: '2026-05-01T00:00:00.000000+00:00' });
    jest.setSystemTime(new Date('2026-05-08T13:00:00.999Z'));

    // Act
    const presenter = await target.execute();

    // Assert
    expect(presenter.assembled_at).toBe('2026-05-08T13:00:00.999000+00:00');
  });
});
