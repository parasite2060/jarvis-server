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
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { emptySessionLog } from '../../../agents/extraction-summary.schema';
import * as extractionAgent from '../../../agents/light-extraction.agent';
import type { BuildLightExtractionAgentOptions } from '../../../agents/light-extraction.agent';

describe('RunExtractionActivity', () => {
  let target: RunExtractionActivity;
  let mockAgentFactory: DeepMocked<DeepAgentFactory>;
  let mockPromptCache: DeepMocked<PromptCacheService>;
  let mockDreamPhaseRepo: DeepMocked<IDreamPhaseRepository>;
  let mockConfig: DeepMocked<AppConfigService>;

  beforeEach(async () => {
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
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('skips extraction (no_extract: true) when user_message_count < threshold', async () => {
    // Arrange — empty parsed_text proves the gate reads user_message_count, not the text.
    mockDreamPhaseRepo.recordPhase.mockResolvedValue({} as never);

    // Act
    const result = await target.runExtraction({
      dream_id: 1,
      session_id: 's',
      parsed_text: '',
      project: null,
      token_count: null,
      transcript_file: 'transcripts/1_abcd1234.txt',
      user_message_count: 1,
      line_count: 10,
    });

    // Assert
    expect(result.no_extract).toBe(true);
    expect(result.summary).toBe('Session too short');
    expect(mockDreamPhaseRepo.recordPhase).toHaveBeenCalledWith(expect.objectContaining({ dreamId: 1, phase: 'extraction', status: 'completed' }));
  });

  it('proceeds with extraction when user_message_count >= threshold (even with empty parsed_text)', async () => {
    // Arrange — empty parsed_text again; a count >= 3 must drive the agent run.
    mockDreamPhaseRepo.recordPhase.mockResolvedValue({} as never);
    mockPromptCache.getPrompt.mockReturnValue('Read the file at {transcriptFile} and also search {transcriptFile} patterns.');
    const invoke = jest.fn().mockResolvedValue({ summary: 'did work', no_extract: false, session_log: emptySessionLog() });
    const buildSpy = jest.spyOn(extractionAgent, 'buildLightExtractionAgent').mockReturnValue({ invoke } as never);

    // Act
    const result = await target.runExtraction({
      dream_id: 2,
      session_id: 's',
      parsed_text: '',
      project: null,
      token_count: null,
      transcript_file: 'transcripts/2_abcd1234.txt',
      user_message_count: 5,
      line_count: 120,
    });

    // Assert — extraction was NOT skipped: the agent ran and a real summary came back.
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.no_extract).toBe(false);
    expect(result.summary).toBe('did work');

    // Assert — {transcriptFile} placeholder is fully substituted; no literal remains.
    const [, opts] = buildSpy.mock.calls[0] as [unknown, BuildLightExtractionAgentOptions];
    expect(opts.systemPrompt).not.toContain('{transcriptFile}');
    expect(opts.systemPrompt).toContain('transcripts/2_abcd1234.txt');
  });
});
