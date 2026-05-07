import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Dream } from 'src/shared/domain/entities/dream.entity';
import { DREAM_REPOSITORY, IDreamRepository } from 'src/shared/domain/repositories/dream.repository.interface';
import { GetVaultFileCommand } from 'src/modules/vault/commands/get-vault-file.command';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { AssembleContextUseCase, MAX_MEMORY_LINES, MEMORY_TOOLS_TEXT } from './assemble-context.usecase';

const FIXED_NOW = new Date('2026-05-08T13:00:00.000Z');
const TODAY = '2026-05-08';
const YESTERDAY = '2026-05-07';

const EXPECTED_PATHS_IN_ORDER = [
  'SOUL.md',
  'IDENTITY.md',
  'MEMORY.md',
  `dailys/${TODAY}.md`,
  `dailys/${YESTERDAY}.md`,
  'decisions/_index.md',
  'projects/_index.md',
  'patterns/_index.md',
  'templates/_index.md',
];

function nonNullContent(path: string): { content: string; file_path: string } {
  return { content: `content-of-${path}`, file_path: path };
}

function nullContent(path: string): { content: null; file_path: string } {
  return { content: null, file_path: path };
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

    // Default — every vault read returns deterministic non-null content.
    mockCommandBus.execute.mockImplementation(async (command: unknown) => {
      const cmd = command as GetVaultFileCommand;
      return nonNullContent(cmd.payload.path);
    });
    // Default — no dream row → no health summary.
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

  it('dispatches GetVaultFileCommand for the nine sections in fixed order', async () => {
    // Act
    await target.execute();

    // Assert
    const dispatchedPaths = mockCommandBus.execute.mock.calls.map((call) => {
      const cmd = call[0] as GetVaultFileCommand;
      return cmd.payload.path;
    });
    expect(dispatchedPaths).toEqual(EXPECTED_PATHS_IN_ORDER);
  });

  it('passes max_lines=200 only to MEMORY.md', async () => {
    // Act
    await target.execute();

    // Assert
    const memoryCall = mockCommandBus.execute.mock.calls.find((call) => {
      const cmd = call[0] as GetVaultFileCommand;
      return cmd.payload.path === 'MEMORY.md';
    });
    const memoryCmd = memoryCall![0] as GetVaultFileCommand;
    expect(memoryCmd.payload.max_lines).toBe(MAX_MEMORY_LINES);

    const soulCall = mockCommandBus.execute.mock.calls.find((call) => {
      const cmd = call[0] as GetVaultFileCommand;
      return cmd.payload.path === 'SOUL.md';
    });
    const soulCmd = soulCall![0] as GetVaultFileCommand;
    expect(soulCmd.payload.max_lines).toBeUndefined();
  });

  it('formats every present section as `## <LABEL>\\n\\n<content>` joined by `\\n\\n`', async () => {
    // Act
    const assembled = await target.execute();

    // Assert — verify each section's literal substring + ordering by index.
    const expectedSections = [
      `## SOUL\n\ncontent-of-SOUL.md`,
      `## IDENTITY\n\ncontent-of-IDENTITY.md`,
      `## MEMORY\n\ncontent-of-MEMORY.md`,
      `## TODAY (${TODAY})\n\ncontent-of-dailys/${TODAY}.md`,
      `## YESTERDAY (${YESTERDAY})\n\ncontent-of-dailys/${YESTERDAY}.md`,
      `## DECISIONS INDEX\n\ncontent-of-decisions/_index.md`,
      `## PROJECTS INDEX\n\ncontent-of-projects/_index.md`,
      `## PATTERNS INDEX\n\ncontent-of-patterns/_index.md`,
      `## TEMPLATES INDEX\n\ncontent-of-templates/_index.md`,
      `## MEMORY TOOLS\n\n${MEMORY_TOOLS_TEXT}`,
    ];
    let cursor = -1;
    for (const section of expectedSections) {
      const idx = assembled.indexOf(section, cursor + 1);
      expect(idx).toBeGreaterThan(cursor);
      cursor = idx;
    }
    // Sections joined by `\n\n` — full output equals the expected sections joined.
    expect(assembled).toBe(expectedSections.join('\n\n'));
  });

  it('skips a section when CommandBus returns null content and logs context.section.skipped', async () => {
    // Arrange — yesterday's daily missing.
    mockCommandBus.execute.mockImplementation(async (command: unknown) => {
      const cmd = command as GetVaultFileCommand;
      if (cmd.payload.path === `dailys/${YESTERDAY}.md`) return nullContent(cmd.payload.path);
      return nonNullContent(cmd.payload.path);
    });

    // Act
    const assembled = await target.execute();

    // Assert
    expect(assembled).not.toContain(`## YESTERDAY (${YESTERDAY})`);
    expect(assembled).toContain(`## TODAY (${TODAY})`);
    expect(debugSpy).toHaveBeenCalledWith(expect.objectContaining({ event: 'context.section.skipped', section: `YESTERDAY (${YESTERDAY})` }));
  });

  it('always appends `## MEMORY TOOLS` even when all vault reads return null', async () => {
    // Arrange — all vault reads return null content.
    mockCommandBus.execute.mockImplementation(async (command: unknown) => {
      const cmd = command as GetVaultFileCommand;
      return nullContent(cmd.payload.path);
    });

    // Act
    const assembled = await target.execute();

    // Assert — only the MEMORY TOOLS section.
    expect(assembled).toBe(`## MEMORY TOOLS\n\n${MEMORY_TOOLS_TEXT}`);
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ event: 'context.assembly.completed', sectionCount: 1 }));
  });

  it('appends `## VAULT HEALTH` when latest deep dream has issues', async () => {
    // Arrange
    mockDreamRepo.findLatestCompletedDeep.mockResolvedValue(
      new Dream({
        id: 1,
        type: 'deep',
        trigger: 'cron',
        status: 'completed',
        outputRaw: 'health_report={"orphan_notes":["a","b"],"memory_overflow":false}',
        createdAt: FIXED_NOW,
      }),
    );

    // Act
    const assembled = await target.execute();

    // Assert
    expect(assembled).toContain('## VAULT HEALTH\n\n⚠ Vault health: 2 orphan notes');
  });

  it('skips `## VAULT HEALTH` when health summary is empty', async () => {
    // Arrange — all-empty health report.
    mockDreamRepo.findLatestCompletedDeep.mockResolvedValue(
      new Dream({
        id: 1,
        type: 'deep',
        trigger: 'cron',
        status: 'completed',
        outputRaw: 'health_report={"orphan_notes":[],"memory_overflow":false}',
        createdAt: FIXED_NOW,
      }),
    );

    // Act
    const assembled = await target.execute();

    // Assert
    expect(assembled).not.toContain('## VAULT HEALTH');
  });

  it('skips `## VAULT HEALTH` when no completed deep dream exists', async () => {
    // Arrange — repo returns null (default mock).

    // Act
    const assembled = await target.execute();

    // Assert
    expect(assembled).not.toContain('## VAULT HEALTH');
    expect(warnSpy).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'context.healthReport.failed' }));
  });

  it('skips `## VAULT HEALTH` when output_raw lacks the regex marker (no error log)', async () => {
    // Arrange
    mockDreamRepo.findLatestCompletedDeep.mockResolvedValue(
      new Dream({
        id: 1,
        type: 'deep',
        trigger: 'cron',
        status: 'completed',
        outputRaw: 'no health report here',
        createdAt: FIXED_NOW,
      }),
    );

    // Act
    const assembled = await target.execute();

    // Assert
    expect(assembled).not.toContain('## VAULT HEALTH');
    expect(warnSpy).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'context.healthReport.failed' }));
  });

  it('soft-fails on malformed health_report JSON — no VAULT HEALTH, logs context.healthReport.failed', async () => {
    // Arrange — regex matches the braces, JSON.parse throws on the body.
    mockDreamRepo.findLatestCompletedDeep.mockResolvedValue(
      new Dream({
        id: 1,
        type: 'deep',
        trigger: 'cron',
        status: 'completed',
        outputRaw: 'health_report={not, valid, json}',
        createdAt: FIXED_NOW,
      }),
    );

    // Act
    const assembled = await target.execute();

    // Assert
    expect(assembled).not.toContain('## VAULT HEALTH');
    expect(warnSpy).toHaveBeenCalledWith(expect.objectContaining({ event: 'context.healthReport.failed' }));
  });

  it('logs context.assembly.completed with sectionCount + length on success', async () => {
    // Act
    const assembled = await target.execute();

    // Assert — 9 vault sections (all present) + MEMORY TOOLS = 10 sections.
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'context.assembly.completed',
        sectionCount: 10,
        length: assembled.length,
      }),
    );
  });

  it('produces sections joined with EXACTLY `\\n\\n` (no triple newlines)', async () => {
    // Act
    const assembled = await target.execute();

    // Assert
    expect(assembled).not.toMatch(/\n\n\n/);
  });
});
