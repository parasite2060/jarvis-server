import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { DREAM_REPOSITORY, IDreamRepository } from 'src/shared/domain/repositories/dream.repository.interface';
import { GetVaultFileCommand } from 'src/modules/vault/commands/get-vault-file.command';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { AssembleContextUseCase, MAX_MEMORY_LINES } from './assemble-context.usecase';

const FIXED_NOW = new Date('2026-05-08T13:00:00.000Z');
const TODAY = '2026-05-08';
const YESTERDAY = '2026-05-07';

function nonNullContent(path: string): { content: string; file_path: string } {
  return { content: `content-of-${path}`, file_path: path };
}

function nullContent(): { content: null; file_path: string } {
  return { content: null, file_path: '' };
}

describe('AssembleContextUseCase', () => {
  let target: AssembleContextUseCase;
  let mockCommandBus: DeepMocked<CommandBus>;
  let mockDreamRepo: DeepMocked<IDreamRepository>;
  let logSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);
    mockCommandBus = createMock<CommandBus>();
    mockDreamRepo = createMock<IDreamRepository>();

    mockCommandBus.execute.mockImplementation(async (command: unknown) => {
      const cmd = command as GetVaultFileCommand;
      return nonNullContent(cmd.payload.path);
    });
    mockDreamRepo.findLatestCompletedDeep.mockResolvedValue(null);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [AssembleContextUseCase, { provide: CommandBus, useValue: mockCommandBus }, { provide: DREAM_REPOSITORY, useValue: mockDreamRepo }],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = moduleRef.get(AssembleContextUseCase);
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    debugSpy.mockRestore();
    warnSpy.mockRestore();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('returns soul, identity, memory as non-null when vault has those files', async () => {
    const result = await target.execute();
    expect(result.soul).toBe('content-of-SOUL.md');
    expect(result.identity).toBe('content-of-IDENTITY.md');
    expect(result.memory).toBe('content-of-MEMORY.md');
  });

  it('returns recentDailys with today and yesterday content when both exist', async () => {
    const result = await target.execute();
    expect(result.recentDailys).toHaveLength(2);
    expect(result.recentDailys[0]).toEqual({ label: `TODAY (${TODAY})`, content: `content-of-dailys/${TODAY}.md` });
    expect(result.recentDailys[1]).toEqual({ label: `YESTERDAY (${YESTERDAY})`, content: `content-of-dailys/${YESTERDAY}.md` });
  });

  it('returns null for missing sections', async () => {
    mockCommandBus.execute.mockImplementation(async (command: unknown) => {
      const cmd = command as GetVaultFileCommand;
      if (cmd.payload.path === 'SOUL.md') return nullContent();
      return nonNullContent(cmd.payload.path);
    });
    const result = await target.execute();
    expect(result.soul).toBeNull();
    expect(result.identity).toBe('content-of-IDENTITY.md');
  });

  it('logs context.section.skipped when a section is missing', async () => {
    mockCommandBus.execute.mockImplementation(async (command: unknown) => {
      const cmd = command as GetVaultFileCommand;
      if (cmd.payload.path === `dailys/${YESTERDAY}.md`) return nullContent();
      return nonNullContent(cmd.payload.path);
    });
    await target.execute();
    expect(debugSpy).toHaveBeenCalledWith(expect.objectContaining({ event: 'context.section.skipped' }));
  });

  it('passes max_lines=200 only to MEMORY.md', async () => {
    await target.execute();
    const memoryCall = mockCommandBus.execute.mock.calls.find((call) => {
      const cmd = call[0] as unknown as GetVaultFileCommand;
      return cmd.payload.path === 'MEMORY.md';
    });
    expect((memoryCall![0] as unknown as GetVaultFileCommand).payload.max_lines).toBe(MAX_MEMORY_LINES);

    const soulCall = mockCommandBus.execute.mock.calls.find((call) => {
      const cmd = call[0] as unknown as GetVaultFileCommand;
      return cmd.payload.path === 'SOUL.md';
    });
    expect((soulCall![0] as unknown as GetVaultFileCommand).payload.max_lines).toBeUndefined();
  });

  it('includes assembled_at in result', async () => {
    const result = await target.execute();
    expect(result.assembled_at).toBe(TODAY);
  });

  it('logs context.assembly.completed on success', async () => {
    await target.execute();
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ event: 'context.assembly.completed' }));
  });

  it('returns empty recentDailys when both dailys are missing', async () => {
    mockCommandBus.execute.mockImplementation(async (command: unknown) => {
      const cmd = command as GetVaultFileCommand;
      if (cmd.payload.path.startsWith('dailys/')) return nullContent();
      return nonNullContent(cmd.payload.path);
    });
    const result = await target.execute();
    expect(result.recentDailys).toEqual([]);
  });
});
