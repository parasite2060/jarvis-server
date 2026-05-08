/**
 * Unit tests for `RunPhase3DeepSleepActivity` (Story 13.10.5 / Q4 decomposition).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { RunPhase3DeepSleepActivity } from './run-phase3-deep-sleep.activity';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import { PromptCacheService } from 'src/shared/agents/prompt-cache.service';
import { AppConfigService } from 'src/shared/config/config.service';
import { DREAM_PHASE_REPOSITORY, IDreamPhaseRepository } from 'src/shared/domain/repositories/dream-phase.repository.interface';
import { MEMU_API, IMemuApi } from 'src/shared/domain/apis/memu-api.interface';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { ConsolidationOutputSchema } from '../../../agents/consolidation-output.schema';

jest.mock('deepagents', () => ({ createDeepAgent: jest.fn().mockReturnValue({ invoke: jest.fn() }) }));

describe('RunPhase3DeepSleepActivity', () => {
  let target: RunPhase3DeepSleepActivity;
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
    Object.defineProperty(mockConfig, 'deepPhase3Limits', { configurable: true, get: () => ({ maxTokens: 1, maxIterations: 1 }) });
    mockPromptCache.getPrompt.mockReturnValue('test prompt');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RunPhase3DeepSleepActivity,
        { provide: MEMU_API, useValue: mockMemuApi },
        { provide: DeepAgentFactory, useValue: mockAgentFactory },
        { provide: PromptCacheService, useValue: mockPromptCache },
        { provide: DREAM_PHASE_REPOSITORY, useValue: mockPhaseRepo },
        { provide: AppConfigService, useValue: mockConfig },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(RunPhase3DeepSleepActivity);
  });

  it('records completed phase with consolidation_json output', async () => {
    // Arrange
    const out = {
      memory_md: 'updated',
      daily_summary: 'summary',
      stats: { total_memories_processed: 1, duplicates_removed: 0, contradictions_resolved: 0, patterns_promoted: 0, stale_pruned: 0 },
      vault_updates: { decisions: [], projects: [], patterns: [], templates: [], concepts: [], connections: [], lessons: [], topics: [] },
      vault_writes: [],
    };
    mockAgentFactory.create.mockReturnValue({
      usageLimits: { totalTokens: 1, toolCalls: 1 },
      outputSchema: ConsolidationOutputSchema,
      invoke: async () => out,
    });

    // Act
    const result = await target.runPhase3DeepSleep({
      dream_id: 1,
      source_date_iso: '2026-05-07',
      memu_memories: [],
      memory_md: '',
      daily_log: '',
      soul_md: '',
      phase1_summary: 'p1',
      phase2_summary: 'p2',
    });

    // Assert
    expect(result.consolidation_json['memory_md']).toBe('updated');
    const args = mockPhaseRepo.recordPhase.mock.calls[0]![0];
    expect(args.phase).toBe('phase3_deep_sleep');
    expect(args.status).toBe('completed');
  });
});
