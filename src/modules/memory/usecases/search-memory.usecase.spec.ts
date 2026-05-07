import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Logger } from '@nestjs/common';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { IMemuApi, MEMU_API } from 'src/shared/domain/apis/memu-api.interface';
import { MemuError, MemuUnavailableError } from 'src/shared/api/errors/memu.errors';
import { SearchMemoryUseCase } from './search-memory.usecase';
import { SearchMemoryRequest } from '../models/requests/search-memory.request';

describe('SearchMemoryUseCase', () => {
  let target: SearchMemoryUseCase;
  let mockMemuApi: DeepMocked<IMemuApi>;
  let logSpy: jest.SpyInstance;

  beforeEach(async () => {
    mockMemuApi = createMock<IMemuApi>();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [SearchMemoryUseCase, { provide: MEMU_API, useValue: mockMemuApi }],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = moduleRef.get(SearchMemoryUseCase);
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('happy path — maps memu memories to results and logs counts only', async () => {
    // Arrange
    const request: SearchMemoryRequest = { query: 'foo', method: 'rag' };
    mockMemuApi.retrieve.mockResolvedValue({
      memories: [
        { content: 'memo-1', relevance: 0.9, source: 'src1', metadata: { kind: 'note' } },
        { content: 'memo-2', relevance: 0.7 },
      ],
    });

    // Act
    const response = await target.execute(request);

    // Assert
    expect(response.results).toHaveLength(2);
    expect(response.results[0]).toEqual({
      content: 'memo-1',
      relevance: 0.9,
      source: 'src1',
      metadata: { kind: 'note' },
    });
    expect(response.query).toBe('foo');
    expect(response.method).toBe('rag');
    expect(mockMemuApi.retrieve).toHaveBeenCalledWith('foo', 'rag');
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'memory.search.completed',
        queryLength: 3,
        resultCount: 2,
      }),
    );
  });

  it('empty memories — returns empty results array', async () => {
    // Arrange
    mockMemuApi.retrieve.mockResolvedValue({ memories: [] });
    const request: SearchMemoryRequest = { query: 'q', method: 'rag' };

    // Act
    const response = await target.execute(request);

    // Assert
    expect(response.results).toEqual([]);
  });

  it('MemU 4xx — MemuError bubbles to caller (no try/catch)', async () => {
    // Arrange
    mockMemuApi.retrieve.mockRejectedValue(new MemuError(400, 'bad query'));
    const request: SearchMemoryRequest = { query: 'q', method: 'rag' };

    // Act / Assert
    await expect(target.execute(request)).rejects.toBeInstanceOf(MemuError);
  });

  it('MemU unavailable — MemuUnavailableError bubbles to caller', async () => {
    // Arrange
    mockMemuApi.retrieve.mockRejectedValue(new MemuUnavailableError('econnrefused'));
    const request: SearchMemoryRequest = { query: 'q', method: 'rag' };

    // Act / Assert
    await expect(target.execute(request)).rejects.toBeInstanceOf(MemuUnavailableError);
  });

  it('forbidden field hygiene — log payload never contains query content', async () => {
    // Arrange
    mockMemuApi.retrieve.mockResolvedValue({ memories: [] });
    const request: SearchMemoryRequest = { query: 'leak-this-secret-query', method: 'rag' };

    // Act
    await target.execute(request);

    // Assert
    const calls = logSpy.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(calls.some((c) => c.includes('leak-this-secret-query'))).toBe(false);
  });
});
