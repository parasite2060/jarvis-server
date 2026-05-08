/**
 * Unit tests for `RunPhase2RemSleepActivity` (Story 13.10.5 / Q4 decomposition).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { RunPhase2RemSleepActivity } from './run-phase2-rem-sleep.activity';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import { PromptCacheService } from 'src/shared/agents/prompt-cache.service';
import { AppConfigService } from 'src/shared/config/config.service';
import { DREAM_PHASE_REPOSITORY, IDreamPhaseRepository } from 'src/shared/domain/repositories/dream-phase.repository.interface';
import { MEMU_API, IMemuApi } from 'src/shared/domain/apis/memu-api.interface';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { REMSleepOutputSchema } from '../../../agents/rem-sleep-output.schema';

jest.mock('deepagents', () => ({ createDeepAgent: jest.fn().mockReturnValue({ invoke: jest.fn() }) }));

describe('RunPhase2RemSleepActivity', () => {
  let target: RunPhase2RemSleepActivity;
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
    Object.defineProperty(mockConfig, 'deepPhase2Limits', { configurable: true, get: () => ({ maxTokens: 1, maxIterations: 1 }) });
    mockPromptCache.getPrompt.mockReturnValue('test prompt');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RunPhase2RemSleepActivity,
        { provide: MEMU_API, useValue: mockMemuApi },
        { provide: DeepAgentFactory, useValue: mockAgentFactory },
        { provide: PromptCacheService, useValue: mockPromptCache },
        { provide: DREAM_PHASE_REPOSITORY, useValue: mockPhaseRepo },
        { provide: AppConfigService, useValue: mockConfig },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(RunPhase2RemSleepActivity);
  });

  it('returns { output_json: null } on agent error (soft-fail policy)', async () => {
    // Arrange
    mockAgentFactory.create.mockReturnValue({
      usageLimits: { totalTokens: 1, toolCalls: 1 },
      outputSchema: REMSleepOutputSchema,
      invoke: async () => {
        throw new Error('phase 2 boom');
      },
    });

    // Act
    const result = await target.runPhase2RemSleep({
      dream_id: 1,
      source_date_iso: '2026-05-07',
      candidates_json: [],
      scored_json: [],
    });

    // Assert
    expect(result.output_json).toBeNull();
    const args = mockPhaseRepo.recordPhase.mock.calls[0]![0];
    expect(args.status).toBe('failed');
  });
});
