/**
 * Unit tests for `RunWeeklyReviewAgentActivity` (Story 13.10.5 / Q4 decomposition).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { RunWeeklyReviewAgentActivity } from './run-weekly-review-agent.activity';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import { PromptCacheService } from 'src/shared/agents/prompt-cache.service';
import { AppConfigService } from 'src/shared/config/config.service';
import { DREAM_PHASE_REPOSITORY, IDreamPhaseRepository } from 'src/shared/domain/repositories/dream-phase.repository.interface';
import { MEMU_API, IMemuApi } from 'src/shared/domain/apis/memu-api.interface';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { ErrorCode } from 'src/utils/error.code';
import { WeeklyReviewOutputSchema } from '../../../agents/weekly-review-output.schema';

jest.mock('deepagents', () => ({
  createDeepAgent: jest.fn().mockReturnValue({ invoke: jest.fn() }),
}));

describe('RunWeeklyReviewAgentActivity', () => {
  let target: RunWeeklyReviewAgentActivity;
  let mockMemuApi: DeepMocked<IMemuApi>;
  let mockAgentFactory: DeepMocked<DeepAgentFactory>;
  let mockPromptCache: DeepMocked<PromptCacheService>;
  let mockPhaseRepo: DeepMocked<IDreamPhaseRepository>;
  let mockConfig: DeepMocked<AppConfigService>;

  beforeEach(async () => {
    mockMemuApi = createMock<IMemuApi>();
    mockAgentFactory = createMock<DeepAgentFactory>();
    mockPromptCache = createMock<PromptCacheService>();
    mockPhaseRepo = createMock<IDreamPhaseRepository>();
    mockConfig = createMock<AppConfigService>();

    Object.defineProperty(mockConfig, 'vaultPath', { configurable: true, get: () => '/tmp/vault' });
    Object.defineProperty(mockConfig, 'weeklyReviewLimits', {
      configurable: true,
      get: () => ({ maxTokens: 1_500_000, maxIterations: 300 }),
    });
    mockPromptCache.getPrompt.mockReturnValue('weekly-review-prompt');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RunWeeklyReviewAgentActivity,
        { provide: MEMU_API, useValue: mockMemuApi },
        { provide: DeepAgentFactory, useValue: mockAgentFactory },
        { provide: PromptCacheService, useValue: mockPromptCache },
        { provide: DREAM_PHASE_REPOSITORY, useValue: mockPhaseRepo },
        { provide: AppConfigService, useValue: mockConfig },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(RunWeeklyReviewAgentActivity);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('runs agent, writes dream_phases row on success', async () => {
    // Arrange
    mockAgentFactory.create.mockReturnValue({
      usageLimits: { totalTokens: 1, toolCalls: 1 },
      outputSchema: WeeklyReviewOutputSchema,
      invoke: async () => ({
        review_content: '# Weekly Review: 2026-W19',
        week_themes: ['auth'],
        stale_action_items: [],
        project_updates: { TaskFlow: 'shipped' },
      }),
    });

    // Act
    const result = await target.runWeeklyReviewAgent({
      dream_id: 5,
      week_start: '2026-05-04',
      daily_logs: { '2026-05-04': 'mon' },
      vault_indexes: { decisions: 'idx' },
      vault_guide: 'guide',
    });

    // Assert
    expect(result.review_content).toBe('# Weekly Review: 2026-W19');
    expect(result.week_themes).toEqual(['auth']);
    expect(result.project_updates).toEqual({ TaskFlow: 'shipped' });
    expect(mockPhaseRepo.recordPhase).toHaveBeenCalledWith(expect.objectContaining({ dreamId: 5, phase: 'weekly_review', status: 'completed' }));
  });

  it('throws WEEKLY_REVIEW_AGENT_FAILED + records failed phase on agent error', async () => {
    // Arrange
    mockAgentFactory.create.mockReturnValue({
      usageLimits: { totalTokens: 1, toolCalls: 1 },
      outputSchema: WeeklyReviewOutputSchema,
      invoke: async () => {
        throw new Error('llm timeout');
      },
    });

    // Act
    const promise = target.runWeeklyReviewAgent({
      dream_id: 6,
      week_start: '2026-05-04',
      daily_logs: { '2026-05-04': 'mon' },
      vault_indexes: {},
      vault_guide: '',
    });

    // Assert
    await expect(promise).rejects.toMatchObject({ code: ErrorCode.WEEKLY_REVIEW_AGENT_FAILED });
    expect(mockPhaseRepo.recordPhase).toHaveBeenCalledWith(expect.objectContaining({ dreamId: 6, phase: 'weekly_review', status: 'failed' }));
  });

  it('throws WEEKLY_REVIEW_OUTPUT_INVALID on Zod validation error', async () => {
    // Arrange
    mockAgentFactory.create.mockReturnValue({
      usageLimits: { totalTokens: 1, toolCalls: 1 },
      outputSchema: WeeklyReviewOutputSchema,
      invoke: async () => ({ review_content: 123 }) as never,
    });

    // Act
    const promise = target.runWeeklyReviewAgent({
      dream_id: 7,
      week_start: '2026-05-04',
      daily_logs: { '2026-05-04': 'mon' },
      vault_indexes: {},
      vault_guide: '',
    });

    // Assert
    await expect(promise).rejects.toMatchObject({ code: ErrorCode.WEEKLY_REVIEW_OUTPUT_INVALID });
  });
});
