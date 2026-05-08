/**
 * Unit tests for `RunExtractionActivity` (Story 13.10.5 / Q4 decomposition).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { RunExtractionActivity } from './run-extraction.activity';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import { PromptCacheService } from 'src/shared/agents/prompt-cache.service';
import { AppConfigService } from 'src/shared/config/config.service';
import { DREAM_PHASE_REPOSITORY, IDreamPhaseRepository } from 'src/shared/domain/repositories/dream-phase.repository.interface';
import { MEMU_API, IMemuApi } from 'src/shared/domain/apis/memu-api.interface';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';

describe('RunExtractionActivity', () => {
  let target: RunExtractionActivity;
  let mockMemuApi: DeepMocked<IMemuApi>;
  let mockAgentFactory: DeepMocked<DeepAgentFactory>;
  let mockPromptCache: DeepMocked<PromptCacheService>;
  let mockDreamPhaseRepo: DeepMocked<IDreamPhaseRepository>;
  let mockConfig: DeepMocked<AppConfigService>;

  beforeEach(async () => {
    mockMemuApi = createMock<IMemuApi>();
    mockAgentFactory = createMock<DeepAgentFactory>();
    mockPromptCache = createMock<PromptCacheService>();
    mockDreamPhaseRepo = createMock<IDreamPhaseRepository>();
    mockConfig = createMock<AppConfigService>();

    Object.defineProperty(mockConfig, 'lightExtractionLimits', {
      get: () => ({ maxTokens: 1_000_000, maxIterations: 100 }),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RunExtractionActivity,
        { provide: MEMU_API, useValue: mockMemuApi },
        { provide: DeepAgentFactory, useValue: mockAgentFactory },
        { provide: PromptCacheService, useValue: mockPromptCache },
        { provide: DREAM_PHASE_REPOSITORY, useValue: mockDreamPhaseRepo },
        { provide: AppConfigService, useValue: mockConfig },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(RunExtractionActivity);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns no_extract: true when userMessageCount < 3', async () => {
    // Arrange
    mockDreamPhaseRepo.recordPhase.mockResolvedValue({} as never);

    // Act
    const result = await target.runExtraction({
      dream_id: 1,
      session_id: 's',
      parsed_text: '[2026-01-01T00:00:00Z] User: only one\n',
      project: null,
      token_count: null,
      transcript_file: null,
    });

    // Assert
    expect(result.no_extract).toBe(true);
    expect(result.summary).toBe('Session too short');
    expect(mockDreamPhaseRepo.recordPhase).toHaveBeenCalledWith(expect.objectContaining({ dreamId: 1, phase: 'extraction', status: 'completed' }));
  });
});
