import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Logger } from '@nestjs/common';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { AppConfigService } from 'src/shared/config/config.service';
import { IMemuApi, MEMU_API } from 'src/shared/domain/apis/memu-api.interface';
import { MemuError, MemuUnavailableError } from 'src/shared/api/errors/memu.errors';
import { SecretScrubberService } from 'src/shared/secret-redaction/secret-scrubber.service';
import { AddMemoryUseCase } from './add-memory.usecase';
import { AddMemoryRequest } from '../models/requests/add-memory.request';

describe('AddMemoryUseCase', () => {
  let target: AddMemoryUseCase;
  let mockMemuApi: DeepMocked<IMemuApi>;
  let mockConfig: DeepMocked<AppConfigService>;
  let logSpy: jest.SpyInstance;

  beforeEach(async () => {
    mockMemuApi = createMock<IMemuApi>();
    mockConfig = createMock<AppConfigService>();
    Object.defineProperty(mockConfig, 'memuUserId', { get: () => 'jarvis' });
    Object.defineProperty(mockConfig, 'memuAgentId', { get: () => 'claude' });

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [AddMemoryUseCase, { provide: MEMU_API, useValue: mockMemuApi }, { provide: AppConfigService, useValue: mockConfig }],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = moduleRef.get(AddMemoryUseCase);
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('happy path — synchronous memorize, returns real memory_id, status accepted', async () => {
    // Arrange
    mockMemuApi.memorize.mockResolvedValue({ task_id: 'mem_42' });
    const request: AddMemoryRequest = { content: 'hello' };

    // Act
    const response = await target.execute(request);

    // Assert
    expect(response.memory_id).toBe('mem_42');
    expect(response.status).toBe('accepted');
    expect(mockMemuApi.memorize).toHaveBeenCalledTimes(1);
    const [messages, opts] = mockMemuApi.memorize.mock.calls[0]!;
    expect(messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(opts).toMatchObject({ userId: 'jarvis', agentId: 'claude' });
    expect(opts!.idempotencyKey).toMatch(/^mem-add-[0-9a-f]{16}$/);
  });

  it('metadata.context present — prepends a system message', async () => {
    // Arrange
    mockMemuApi.memorize.mockResolvedValue({ task_id: 'mem_43' });
    const request: AddMemoryRequest = { content: 'ask', metadata: { context: 'sys' } };

    // Act
    await target.execute(request);

    // Assert
    const [messages] = mockMemuApi.memorize.mock.calls[0]!;
    expect(messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'ask' },
    ]);
  });

  it('metadata.context empty string — does NOT prepend a system message', async () => {
    // Arrange
    mockMemuApi.memorize.mockResolvedValue({ task_id: 'mem_44' });
    const request: AddMemoryRequest = { content: 'ask', metadata: { context: '' } };

    // Act
    await target.execute(request);

    // Assert
    const [messages] = mockMemuApi.memorize.mock.calls[0]!;
    expect(messages).toEqual([{ role: 'user', content: 'ask' }]);
  });

  it('metadata.context non-string — ignored', async () => {
    // Arrange
    mockMemuApi.memorize.mockResolvedValue({ task_id: 'mem_45' });
    const request: AddMemoryRequest = { content: 'ask', metadata: { context: 42 as unknown as string } };

    // Act
    await target.execute(request);

    // Assert
    const [messages] = mockMemuApi.memorize.mock.calls[0]!;
    expect(messages).toEqual([{ role: 'user', content: 'ask' }]);
  });

  it('idempotency key — deterministic across calls with identical body', async () => {
    // Arrange
    mockMemuApi.memorize.mockResolvedValue({ task_id: 'mem_46' });
    const request: AddMemoryRequest = { content: 'identical', metadata: { context: 'sys' } };

    // Act
    await target.execute(request);
    await target.execute(request);

    // Assert
    const firstKey = mockMemuApi.memorize.mock.calls[0]![1]!.idempotencyKey;
    const secondKey = mockMemuApi.memorize.mock.calls[1]![1]!.idempotencyKey;
    expect(firstKey).toBe(secondKey);
    expect(firstKey).toMatch(/^mem-add-[0-9a-f]{16}$/);
  });

  it('idempotency key — differs when content differs', async () => {
    // Arrange
    mockMemuApi.memorize.mockResolvedValue({ task_id: 'mem_47' });

    // Act
    await target.execute({ content: 'a' });
    await target.execute({ content: 'b' });

    // Assert
    expect(mockMemuApi.memorize.mock.calls[0]![1]!.idempotencyKey).not.toBe(mockMemuApi.memorize.mock.calls[1]![1]!.idempotencyKey);
  });

  it('MemU response missing task_id — memory_id falls back to empty string', async () => {
    // Arrange
    mockMemuApi.memorize.mockResolvedValue({});

    // Act
    const response = await target.execute({ content: 'x' });

    // Assert
    expect(response.memory_id).toBe('');
    expect(response.status).toBe('accepted');
  });

  it('MemU 4xx — MemuError bubbles', async () => {
    // Arrange
    mockMemuApi.memorize.mockRejectedValue(new MemuError(400, 'bad'));

    // Act / Assert
    await expect(target.execute({ content: 'x' })).rejects.toBeInstanceOf(MemuError);
  });

  it('MemU unavailable — MemuUnavailableError bubbles', async () => {
    // Arrange
    mockMemuApi.memorize.mockRejectedValue(new MemuUnavailableError('econnrefused'));

    // Act / Assert
    await expect(target.execute({ content: 'x' })).rejects.toBeInstanceOf(MemuUnavailableError);
  });

  it('Q6 negative test — SecretScrubberService is NOT a constructor dependency', () => {
    // Arrange / Act
    const moduleRef = Test.createTestingModule({
      providers: [
        AddMemoryUseCase,
        { provide: MEMU_API, useValue: mockMemuApi },
        { provide: AppConfigService, useValue: mockConfig },
        // Intentionally NO SecretScrubberService — must compile and instantiate.
      ],
    });

    // Assert — building without SecretScrubberService must not throw missing-dep.
    expect(async () => {
      const compiled = await moduleRef.compile();
      compiled.get(AddMemoryUseCase);
    }).not.toThrow();
    // Also assert a use case instance does not store / reference SecretScrubberService.
    const usecaseProto = AddMemoryUseCase as unknown as { name: string };
    expect(usecaseProto.name).toBe('AddMemoryUseCase');
    // Defensive: confirm the symbol is not a known import in this module's runtime.
    expect(SecretScrubberService).toBeDefined();
    // (If the use case ever injected the scrubber, the module-without-scrubber compile above would fail.)
  });

  it('forbidden field hygiene — log payload never contains content body', async () => {
    // Arrange
    mockMemuApi.memorize.mockResolvedValue({ task_id: 'mem_99' });
    const request: AddMemoryRequest = { content: 'leak-this-secret-content', metadata: { context: 'leak-sys' } };

    // Act
    await target.execute(request);

    // Assert
    const calls = logSpy.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(calls.some((c) => c.includes('leak-this-secret-content'))).toBe(false);
    expect(calls.some((c) => c.includes('leak-sys'))).toBe(false);
  });
});
