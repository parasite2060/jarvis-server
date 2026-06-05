/**
 * Unit tests for `GetConfigUseCase` (Story 13.13).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { CommandBus } from '@nestjs/cqrs';
import {
  GetConfigUseCase,
  DEFAULT_AUTO_MERGE,
  DEFAULT_DEEP_DREAM_CRON,
  DEFAULT_MAX_MEMORY_LINES,
  DEFAULT_WEEKLY_REVIEW_CRON,
} from './get-config.usecase';
import { GetVaultFileCommand } from 'src/modules/vault/commands/get-vault-file.command';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';

describe('GetConfigUseCase', () => {
  let target: GetConfigUseCase;
  let mockCommandBus: DeepMocked<CommandBus>;

  beforeEach(async () => {
    mockCommandBus = createMock<CommandBus>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [GetConfigUseCase, { provide: CommandBus, useValue: mockCommandBus }],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(GetConfigUseCase);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('dispatches GetVaultFileCommand with config.yml path and returns parsed values', async () => {
    // Arrange
    mockCommandBus.execute.mockResolvedValue({
      content: 'auto_merge: false\ndeep_dream_cron: "0 22 * * *"\nweekly_review_cron: "0 23 * * 0"\nmax_memory_lines: 300\n',
      file_path: 'config.yml',
    });

    // Act
    const result = await target.execute();

    // Assert
    const dispatched = mockCommandBus.execute.mock.calls[0]![0] as GetVaultFileCommand;
    expect(dispatched).toBeInstanceOf(GetVaultFileCommand);
    expect(dispatched.payload.path).toBe('config.yml');
    expect(result.autoMerge).toBe(false);
    expect(result.deepDreamCron).toBe('0 22 * * *');
    expect(result.weeklyReviewCron).toBe('0 23 * * 0');
    expect(result.maxMemoryLines).toBe(300);
  });

  it('applies defaults when config.yml is empty / missing', async () => {
    // Arrange — null content
    mockCommandBus.execute.mockResolvedValue({ content: null, file_path: 'config.yml' });

    // Act
    const result = await target.execute();

    // Assert — all defaults
    expect(result.autoMerge).toBe(DEFAULT_AUTO_MERGE);
    expect(result.deepDreamCron).toBe(DEFAULT_DEEP_DREAM_CRON);
    expect(result.weeklyReviewCron).toBe(DEFAULT_WEEKLY_REVIEW_CRON);
    expect(result.maxMemoryLines).toBe(DEFAULT_MAX_MEMORY_LINES);
  });

  it('falls back to defaults silently on read failure (Python parity)', async () => {
    // Arrange
    mockCommandBus.execute.mockRejectedValue(new Error('vault read failed'));

    // Act
    const result = await target.execute();

    // Assert — defaults applied; no throw
    expect(result.weeklyReviewCron).toBe(DEFAULT_WEEKLY_REVIEW_CRON);
  });

  it('includes weeklyReviewCron in response (FIXES Python bug #2)', async () => {
    // Arrange — config.yml has weekly cron explicitly
    mockCommandBus.execute.mockResolvedValue({
      content: 'weekly_review_cron: "0 12 * * 1"\n',
      file_path: 'config.yml',
    });

    // Act
    const result = await target.execute();

    // Assert — weekly cron returned (Python's _defaults() omitted this)
    expect(result.weeklyReviewCron).toBe('0 12 * * 1');
  });

  it('partially fills defaults when only some keys present', async () => {
    // Arrange
    mockCommandBus.execute.mockResolvedValue({ content: 'deep_dream_cron: "0 5 * * *"\n', file_path: 'config.yml' });

    // Act
    const result = await target.execute();

    // Assert
    expect(result.deepDreamCron).toBe('0 5 * * *');
    expect(result.weeklyReviewCron).toBe(DEFAULT_WEEKLY_REVIEW_CRON);
    expect(result.autoMerge).toBe(DEFAULT_AUTO_MERGE);
    expect(result.maxMemoryLines).toBe(DEFAULT_MAX_MEMORY_LINES);
  });
});
