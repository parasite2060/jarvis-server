/**
 * Unit tests for `UpdateConfigUseCase` (Story 13.13).
 */
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { CommandBus, EventBus } from '@nestjs/cqrs';
import { UpdateConfigUseCase } from './update-config.usecase';
import { AppConfigService } from 'src/shared/config/config.service';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { CronChangedEvent } from '../events/cron-changed.event';
import { ErrorCode } from 'src/utils/error.code';

describe('UpdateConfigUseCase', () => {
  let target: UpdateConfigUseCase;
  let mockCommandBus: DeepMocked<CommandBus>;
  let mockEventBus: DeepMocked<EventBus>;
  let mockConfig: DeepMocked<AppConfigService>;
  let vaultRoot: string;

  beforeEach(async () => {
    mockCommandBus = createMock<CommandBus>();
    mockEventBus = createMock<EventBus>();
    mockConfig = createMock<AppConfigService>();
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-config-'));
    Object.defineProperty(mockConfig, 'vaultPath', { configurable: true, get: () => vaultRoot });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UpdateConfigUseCase,
        { provide: CommandBus, useValue: mockCommandBus },
        { provide: EventBus, useValue: mockEventBus },
        { provide: AppConfigService, useValue: mockConfig },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(UpdateConfigUseCase);

    // Default: existing config has all default values.
    mockCommandBus.execute.mockResolvedValue({
      content: 'auto_merge: true\ndeep_dream_cron: "0 20 * * *"\nweekly_review_cron: "0 20 * * 0"\nmax_memory_lines: 200\n',
      file_path: 'config.yml',
    });
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await fs.rm(vaultRoot, { recursive: true, force: true }).catch(() => {});
  });

  it('throws CONFIG_VALIDATION_FAILED when no fields are provided', async () => {
    // Act + Assert
    await expect(target.execute({})).rejects.toMatchObject({ code: ErrorCode.CONFIG_VALIDATION_FAILED });
  });

  it('writes merged YAML to config.yml (atomic temp + rename) and returns presenter', async () => {
    // Act
    const result = await target.execute({ deepDreamCron: '0 21 * * *' });

    // Assert — file written
    const written = await fs.readFile(path.join(vaultRoot, 'config.yml'), 'utf-8');
    expect(written).toContain('deep_dream_cron: 0 21 * * *');
    expect(written).toContain('weekly_review_cron: 0 20 * * 0');
    expect(result.deepDreamCron).toBe('0 21 * * *');
  });

  it('publishes CronChangedEvent on deep cron change with nested-payload shape', async () => {
    // Act
    await target.execute({ deepDreamCron: '0 21 * * *' });

    // Assert
    expect(mockEventBus.publish).toHaveBeenCalledTimes(1);
    const event = mockEventBus.publish.mock.calls[0]![0] as CronChangedEvent;
    expect(event).toBeInstanceOf(CronChangedEvent);
    expect(event.payload.kind).toBe('deepDream');
    expect(event.payload.oldCron).toBe('0 20 * * *');
    expect(event.payload.newCron).toBe('0 21 * * *');
  });

  it('publishes TWO CronChangedEvents when both crons change', async () => {
    // Act
    await target.execute({ deepDreamCron: '0 21 * * *', weeklyReviewCron: '0 22 * * 0' });

    // Assert
    expect(mockEventBus.publish).toHaveBeenCalledTimes(2);
    const events = mockEventBus.publish.mock.calls.map((c) => c[0] as CronChangedEvent);
    const kinds = events.map((e) => e.payload.kind);
    expect(kinds).toContain('deepDream');
    expect(kinds).toContain('weeklyReview');
  });

  it('does NOT publish CronChangedEvent when only autoMerge changes', async () => {
    // Act
    await target.execute({ autoMerge: false });

    // Assert
    expect(mockEventBus.publish).not.toHaveBeenCalled();
  });

  it('does NOT publish CronChangedEvent when cron value is unchanged', async () => {
    // Act — request the same cron value as current
    await target.execute({ deepDreamCron: '0 20 * * *' });

    // Assert
    expect(mockEventBus.publish).not.toHaveBeenCalled();
  });

  it('falls back to defaults silently when config.yml read fails', async () => {
    // Arrange
    mockCommandBus.execute.mockRejectedValue(new Error('vault unreachable'));

    // Act
    const result = await target.execute({ deepDreamCron: '0 21 * * *' });

    // Assert — write succeeded with defaults + override
    expect(result.deepDreamCron).toBe('0 21 * * *');
    // Defaults treated as "current"; the user's deep cron differs → event published with default as oldCron
    expect(mockEventBus.publish).toHaveBeenCalledTimes(1);
    const event = mockEventBus.publish.mock.calls[0]![0] as CronChangedEvent;
    expect(event.payload.kind).toBe('deepDream');
    expect(event.payload.oldCron).toBe('0 20 * * *');
    expect(event.payload.newCron).toBe('0 21 * * *');
  });
});
