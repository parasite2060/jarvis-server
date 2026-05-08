/**
 * Unit tests for `RunPhase1LightSleepActivity` (Story 13.10.5 / Q4 decomposition).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { RunPhase1LightSleepActivity } from './run-phase1-light-sleep.activity';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import { PromptCacheService } from 'src/shared/agents/prompt-cache.service';
import { AppConfigService } from 'src/shared/config/config.service';
import { DREAM_PHASE_REPOSITORY, IDreamPhaseRepository } from 'src/shared/domain/repositories/dream-phase.repository.interface';
import { MEMU_API, IMemuApi } from 'src/shared/domain/apis/memu-api.interface';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { LightSleepOutputSchema } from '../../../agents/light-sleep-output.schema';

jest.mock('deepagents', () => ({ createDeepAgent: jest.fn().mockReturnValue({ invoke: jest.fn() }) }));

describe('RunPhase1LightSleepActivity', () => {
  let target: RunPhase1LightSleepActivity;
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
    Object.defineProperty(mockConfig, 'vaultPath', { configurable: true, get: () => '/tmp/vault-not-real' });
    Object.defineProperty(mockConfig, 'deepPhase1Limits', { configurable: true, get: () => ({ maxTokens: 1, maxIterations: 1 }) });
    mockPromptCache.getPrompt.mockReturnValue('test prompt');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RunPhase1LightSleepActivity,
        { provide: MEMU_API, useValue: mockMemuApi },
        { provide: DeepAgentFactory, useValue: mockAgentFactory },
        { provide: PromptCacheService, useValue: mockPromptCache },
        { provide: DREAM_PHASE_REPOSITORY, useValue: mockPhaseRepo },
        { provide: AppConfigService, useValue: mockConfig },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(RunPhase1LightSleepActivity);
  });

  it('records dream_phases on successful run', async () => {
    // Arrange
    mockAgentFactory.create.mockReturnValue({
      usageLimits: { totalTokens: 1, toolCalls: 1 },
      outputSchema: LightSleepOutputSchema,
      invoke: async () => ({
        candidates: [{ content: 'x', category: 'decisions', reinforcement_count: 1, contradiction_flag: false, source_sessions: [] }],
        duplicates_removed: 0,
        contradictions_found: 0,
      }),
    });

    // Act
    const result = await target.runPhase1LightSleep({
      dream_id: 1,
      memu_memories: [],
      memory_md: '',
      daily_log: '',
      soul_md: '',
      source_date_iso: '2026-05-07',
    });

    // Assert
    expect(result.candidates_json).toHaveLength(1);
    expect(mockPhaseRepo.recordPhase).toHaveBeenCalled();
    const args = mockPhaseRepo.recordPhase.mock.calls[0]![0];
    expect(args.phase).toBe('phase1_light_sleep');
    expect(args.status).toBe('completed');
  });

  it('records failed phase when agent throws', async () => {
    // Arrange
    mockAgentFactory.create.mockReturnValue({
      usageLimits: { totalTokens: 1, toolCalls: 1 },
      outputSchema: LightSleepOutputSchema,
      invoke: async () => {
        throw new Error('LLM failed');
      },
    });

    // Act / Assert
    await expect(
      target.runPhase1LightSleep({
        dream_id: 1,
        memu_memories: [],
        memory_md: '',
        daily_log: '',
        soul_md: '',
        source_date_iso: '2026-05-07',
      }),
    ).rejects.toThrow();
    const args = mockPhaseRepo.recordPhase.mock.calls[0]![0];
    expect(args.status).toBe('failed');
  });
});
