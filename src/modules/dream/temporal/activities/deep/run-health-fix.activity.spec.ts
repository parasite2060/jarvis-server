/**
 * Unit tests for `RunHealthFixActivity` (Story 13.10.5 / Q4+Q5 decomposition).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { RunHealthFixActivity } from './run-health-fix.activity';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import { PromptCacheService } from 'src/shared/agents/prompt-cache.service';
import { AppConfigService } from 'src/shared/config/config.service';
import { DREAM_PHASE_REPOSITORY, IDreamPhaseRepository } from 'src/shared/domain/repositories/dream-phase.repository.interface';
import { MEMU_API, IMemuApi } from 'src/shared/domain/apis/memu-api.interface';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { HealthFixOutputSchema } from '../../../agents/health-fix-output.schema';

jest.mock('deepagents', () => ({ createDeepAgent: jest.fn().mockReturnValue({ invoke: jest.fn() }) }));

describe('RunHealthFixActivity', () => {
  let target: RunHealthFixActivity;
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
    Object.defineProperty(mockConfig, 'healthFixLimits', { configurable: true, get: () => ({ maxTokens: 1, maxIterations: 1 }) });
    mockPromptCache.getPrompt.mockReturnValue('test prompt');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RunHealthFixActivity,
        { provide: MEMU_API, useValue: mockMemuApi },
        { provide: DeepAgentFactory, useValue: mockAgentFactory },
        { provide: PromptCacheService, useValue: mockPromptCache },
        { provide: DREAM_PHASE_REPOSITORY, useValue: mockPhaseRepo },
        { provide: AppConfigService, useValue: mockConfig },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(RunHealthFixActivity);
  });

  it("returns 'clean' when first health-check pass shows zero issues (and message history non-empty)", async () => {
    // Arrange
    mockAgentFactory.create.mockReturnValue({
      usageLimits: { totalTokens: 1, toolCalls: 1 },
      outputSchema: HealthFixOutputSchema,
      invoke: async () => ({ actions: [], issues_resolved: 0, issues_skipped: 0, iteration: 1 }),
    });

    // Act
    const result = await target.runHealthFix({
      dream_id: 1,
      source_date_iso: '2026-05-07',
      report_json: {},
      consolidation_messages_json: [{ role: 'user', content: 'prior' }],
      knowledge_gap_names: [],
    });

    // Assert
    expect(result.status).toBe('clean');
    expect(result.total_issues_remaining).toBe(0);
  });

  it("returns 'incomplete' when no message history and issues remain", async () => {
    // Act
    const result = await target.runHealthFix({
      dream_id: 1,
      source_date_iso: '2026-05-07',
      report_json: {},
      consolidation_messages_json: [],
      knowledge_gap_names: ['Gap1'],
    });

    // Assert
    expect(result.status).toBe('incomplete');
    expect(result.total_issues_remaining).toBeGreaterThan(0);
  });
});
