import { HttpService } from '@nestjs/axios';
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { AxiosError, AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { AppConfigService } from 'src/shared/config/config.service';
import { MemuError, MemuUnavailableError } from '../errors/memu.errors';
import { MemuApiService } from './memu-api.service';

function axiosResponse<T>(data: T, status: number = 200): AxiosResponse<T> {
  return {
    data,
    status,
    statusText: 'OK',
    headers: {},
    config: {} as AxiosResponse<T>['config'],
  };
}

function axiosErrorWithStatus(status: number, body: unknown = ''): AxiosError {
  const err = new AxiosError('upstream-error', undefined, undefined, undefined, {
    data: body,
    status,
    statusText: 'err',
    headers: {},
    config: {} as AxiosResponse['config'],
  });
  return err;
}

describe('MemuApiService', () => {
  let target: MemuApiService;
  let mockHttp: DeepMocked<HttpService>;
  let mockConfig: DeepMocked<AppConfigService>;

  beforeEach(async () => {
    mockHttp = createMock<HttpService>();
    mockConfig = createMock<AppConfigService>();
    Object.defineProperty(mockConfig, 'memuApiUrl', { get: () => 'http://memu.test' });
    Object.defineProperty(mockConfig, 'memuUserId', { get: () => 'jarvis' });
    Object.defineProperty(mockConfig, 'memuAgentId', { get: () => 'claude' });

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [MemuApiService, { provide: HttpService, useValue: mockHttp }, { provide: AppConfigService, useValue: mockConfig }],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = moduleRef.get(MemuApiService);
  });

  describe('retrieve', () => {
    it('happy path — POST /retrieve, returns body', async () => {
      // Arrange
      mockHttp.post.mockReturnValue(of(axiosResponse({ memories: [{ content: 'a', relevance: 0.5 }] })));

      // Act
      const result = await target.retrieve('foo');

      // Assert
      expect(result.memories).toHaveLength(1);
      expect(mockHttp.post).toHaveBeenCalledWith(
        '/retrieve',
        { query: 'foo' },
        expect.objectContaining({ baseURL: 'http://memu.test', timeout: 10000 }),
      );
    });

    it('4xx — fails fast with MemuError carrying upstream status', async () => {
      // Arrange
      mockHttp.post.mockReturnValue(throwError(() => axiosErrorWithStatus(400, 'bad-query')));

      // Act / Assert
      await expect(target.retrieve('q')).rejects.toMatchObject({ statusCode: 400 });
      await expect(target.retrieve('q')).rejects.toBeInstanceOf(MemuError);
      expect(mockHttp.post).toHaveBeenCalledTimes(2);
    });

    it('network error — MemuUnavailableError without retries', async () => {
      // Arrange
      const transportErr = new AxiosError('ECONNREFUSED', 'ECONNREFUSED');
      mockHttp.post.mockReturnValue(throwError(() => transportErr));

      // Act / Assert
      await expect(target.retrieve('q')).rejects.toBeInstanceOf(MemuUnavailableError);
      expect(mockHttp.post).toHaveBeenCalledTimes(1);
    });

    it('5xx exhausted — retries 3 times then MemuUnavailableError', async () => {
      // Arrange
      mockHttp.post.mockReturnValue(throwError(() => axiosErrorWithStatus(503, 'busy')));

      // Act / Assert
      await expect(target.retrieve('q')).rejects.toBeInstanceOf(MemuUnavailableError);
      // 1 initial + 3 retries = 4 attempts.
      expect(mockHttp.post).toHaveBeenCalledTimes(4);
    });

    it('5xx then 200 — recovers on retry', async () => {
      // Arrange
      let calls = 0;
      mockHttp.post.mockImplementation(() => {
        calls++;
        if (calls === 1) return throwError(() => axiosErrorWithStatus(503));
        return of(axiosResponse({ memories: [] }));
      });

      // Act
      const result = await target.retrieve('q');

      // Assert
      expect(result).toEqual({ memories: [] });
      expect(calls).toBe(2);
    });
  });

  describe('memorize', () => {
    it('happy path — sends conversation + user_id + agent_id; returns task_id', async () => {
      // Arrange
      mockHttp.post.mockReturnValue(of(axiosResponse({ task_id: 'mem_42' })));

      // Act
      const result = await target.memorize([{ role: 'user', content: 'hi' }]);

      // Assert
      expect(result.task_id).toBe('mem_42');
      expect(mockHttp.post).toHaveBeenCalledWith(
        '/memorize',
        { conversation: [{ role: 'user', content: 'hi' }], user_id: 'jarvis', agent_id: 'claude' },
        expect.objectContaining({ baseURL: 'http://memu.test', timeout: 10000 }),
      );
    });

    it('Idempotency-Key — forwarded as HTTP header when opts.idempotencyKey provided', async () => {
      // Arrange
      mockHttp.post.mockReturnValue(of(axiosResponse({ task_id: 'mem_x' })));

      // Act
      await target.memorize([{ role: 'user', content: 'hi' }], { idempotencyKey: 'mem-add-abc123' });

      // Assert
      const config = mockHttp.post.mock.calls[0]![2];
      expect(config?.headers).toEqual(expect.objectContaining({ 'Idempotency-Key': 'mem-add-abc123' }));
    });

    it('opts.userId / agentId override config defaults', async () => {
      // Arrange
      mockHttp.post.mockReturnValue(of(axiosResponse({ task_id: 'mem_y' })));

      // Act
      await target.memorize([{ role: 'user', content: 'hi' }], { userId: 'alt-user', agentId: 'alt-agent' });

      // Assert
      expect(mockHttp.post).toHaveBeenCalledWith(
        '/memorize',
        expect.objectContaining({ user_id: 'alt-user', agent_id: 'alt-agent' }),
        expect.any(Object),
      );
    });

    it('4xx — MemuError', async () => {
      // Arrange
      mockHttp.post.mockReturnValue(throwError(() => axiosErrorWithStatus(422, 'bad-shape')));

      // Act / Assert
      await expect(target.memorize([{ role: 'user', content: 'x' }])).rejects.toBeInstanceOf(MemuError);
    });

    it('5xx exhausted — MemuUnavailableError after 3 retries', async () => {
      // Arrange
      mockHttp.post.mockReturnValue(throwError(() => axiosErrorWithStatus(500)));

      // Act / Assert
      await expect(target.memorize([{ role: 'user', content: 'x' }])).rejects.toBeInstanceOf(MemuUnavailableError);
      expect(mockHttp.post).toHaveBeenCalledTimes(4);
    });
  });
});
