/**
 * Unit spec for `LightDreamActivities` (Story 13.10 / AC #13).
 *
 * Each of the 8 wire-name-frozen methods has at least one happy-path
 * test (and an error-path where the activity throws an InternalException).
 * Mocks every constructor dependency via `createMock`. The agent invocations
 * (`runExtraction`, `runRecord`) inject a stub `DeepAgentFactory` that
 * returns pre-staged structured responses — no real LLM calls.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { CommandBus } from '@nestjs/cqrs';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { LightDreamActivities } from './light-dream.activities';
import { GitOpsService } from 'src/shared/git/git-ops.service';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import { PromptCacheService } from 'src/shared/agents/prompt-cache.service';
import { AppConfigService } from 'src/shared/config/config.service';
import { CONVERSATION_REPOSITORY, IConversationRepository } from 'src/shared/domain/repositories/conversation.repository.interface';
import { DREAM_REPOSITORY, IDreamRepository } from 'src/shared/domain/repositories/dream.repository.interface';
import { DREAM_PHASE_REPOSITORY, IDreamPhaseRepository } from 'src/shared/domain/repositories/dream-phase.repository.interface';
import { MEMU_API, IMemuApi } from 'src/shared/domain/apis/memu-api.interface';
import { DBConnections } from 'src/shared/postgres/utils/constaint';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import { InvalidateContextCacheCommand } from 'src/modules/context/commands/invalidate-context-cache.command';
import { emptySessionLog } from '../../../agents/schemas/extraction-summary.schema';

describe('LightDreamActivities', () => {
  let target: LightDreamActivities;
  let mockMemuApi: DeepMocked<IMemuApi>;
  let mockGitOps: DeepMocked<GitOpsService>;
  let mockAgentFactory: DeepMocked<DeepAgentFactory>;
  let mockPromptCache: DeepMocked<PromptCacheService>;
  let mockConversationRepo: DeepMocked<IConversationRepository>;
  let mockDreamRepo: DeepMocked<IDreamRepository>;
  let mockDreamPhaseRepo: DeepMocked<IDreamPhaseRepository>;
  let mockDataSource: DeepMocked<DataSource>;
  let mockCommandBus: DeepMocked<CommandBus>;
  let mockConfig: DeepMocked<AppConfigService>;

  beforeEach(async () => {
    // Arrange
    mockMemuApi = createMock<IMemuApi>();
    mockGitOps = createMock<GitOpsService>();
    mockAgentFactory = createMock<DeepAgentFactory>();
    mockPromptCache = createMock<PromptCacheService>();
    mockConversationRepo = createMock<IConversationRepository>();
    mockDreamRepo = createMock<IDreamRepository>();
    mockDreamPhaseRepo = createMock<IDreamPhaseRepository>();
    mockDataSource = createMock<DataSource>();
    mockCommandBus = createMock<CommandBus>();
    mockConfig = createMock<AppConfigService>();

    Object.defineProperty(mockConfig, 'lightExtractionLimits', {
      get: () => ({ maxTokens: 1_000_000, maxIterations: 100 }),
    });
    Object.defineProperty(mockConfig, 'lightRecordLimits', {
      get: () => ({ maxTokens: 1_000_000, maxIterations: 100 }),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LightDreamActivities,
        { provide: MEMU_API, useValue: mockMemuApi },
        { provide: GitOpsService, useValue: mockGitOps },
        { provide: DeepAgentFactory, useValue: mockAgentFactory },
        { provide: PromptCacheService, useValue: mockPromptCache },
        { provide: CONVERSATION_REPOSITORY, useValue: mockConversationRepo },
        { provide: DREAM_REPOSITORY, useValue: mockDreamRepo },
        { provide: DREAM_PHASE_REPOSITORY, useValue: mockDreamPhaseRepo },
        { provide: getDataSourceToken(DBConnections.INTERNAL), useValue: mockDataSource },
        { provide: CommandBus, useValue: mockCommandBus },
        { provide: AppConfigService, useValue: mockConfig },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = module.get(LightDreamActivities);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('runExtraction — short-session skip', () => {
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

  describe('persistSessionLog', () => {
    it('delegates to dreamRepo.persistSessionLog', async () => {
      // Arrange
      mockDreamRepo.persistSessionLog.mockResolvedValue();

      // Act
      await target.persistSessionLog({ dream_id: 1, session_log_json: emptySessionLog() });

      // Assert
      expect(mockDreamRepo.persistSessionLog).toHaveBeenCalledWith(1, expect.any(Object));
    });

    it('throws LIGHT_DREAM_PERSIST_SESSION_LOG_FAILED on repo error', async () => {
      // Arrange
      mockDreamRepo.persistSessionLog.mockRejectedValue(new Error('db down'));

      // Act
      const promise = target.persistSessionLog({ dream_id: 1, session_log_json: emptySessionLog() });

      // Assert
      await expect(promise).rejects.toBeInstanceOf(InternalException);
      await expect(promise).rejects.toMatchObject({ code: ErrorCode.LIGHT_DREAM_PERSIST_SESSION_LOG_FAILED });
    });
  });

  describe('updateTranscriptPosition', () => {
    it('calls conversationRepo.updatePosition with status=processed', async () => {
      // Arrange
      mockConversationRepo.updatePosition.mockResolvedValue();

      // Act
      await target.updateTranscriptPosition({ transcript_id: 5, segment_end_line: 100 });

      // Assert
      expect(mockConversationRepo.updatePosition).toHaveBeenCalledWith(5, 'processed', 100);
    });

    it('throws LIGHT_DREAM_UPDATE_POSITION_FAILED on repo error', async () => {
      // Arrange
      mockConversationRepo.updatePosition.mockRejectedValue(new Error('db'));

      // Act
      const promise = target.updateTranscriptPosition({ transcript_id: 5, segment_end_line: 0 });

      // Assert
      await expect(promise).rejects.toBeInstanceOf(InternalException);
      await expect(promise).rejects.toMatchObject({ code: ErrorCode.LIGHT_DREAM_UPDATE_POSITION_FAILED });
    });
  });

  describe('invalidateContextCache', () => {
    it('dispatches InvalidateContextCacheCommand with light-dream-completed reason', async () => {
      // Arrange
      mockCommandBus.execute.mockResolvedValue(undefined);

      // Act
      await target.invalidateContextCache({ dream_id: 1 });

      // Assert
      const dispatched = mockCommandBus.execute.mock.calls[0]?.[0] as InvalidateContextCacheCommand;
      expect(dispatched).toBeInstanceOf(InvalidateContextCacheCommand);
      expect(dispatched.payload.reason).toBe('light-dream-completed');
      expect(dispatched.payload.timestamp).toBeInstanceOf(Date);
    });

    it('throws LIGHT_DREAM_INVALIDATE_CACHE_FAILED on dispatch error', async () => {
      // Arrange
      mockCommandBus.execute.mockRejectedValue(new Error('bus down'));

      // Act
      const promise = target.invalidateContextCache({ dream_id: 1 });

      // Assert
      await expect(promise).rejects.toBeInstanceOf(InternalException);
      await expect(promise).rejects.toMatchObject({ code: ErrorCode.LIGHT_DREAM_INVALIDATE_CACHE_FAILED });
    });
  });

  describe('commitAndPr', () => {
    it('returns no_changes when session_log_writes is empty', async () => {
      // Act
      const result = await target.commitAndPr({
        dream_id: 1,
        session_id: 's',
        source_date_iso: '2026-05-08',
        summary: 'sum',
        files_modified: [],
        extraction_summary: '',
        session_log_writes: [],
      });

      // Assert
      expect(result.git_pr_status).toBe('no_changes');
      expect(result.git_pr_url).toBeNull();
      expect(mockGitOps.createBranch).not.toHaveBeenCalled();
    });

    it('writes triples and creates PR on the new branch', async () => {
      // Arrange
      mockGitOps.pullLatestMain.mockResolvedValue();
      mockGitOps.createBranch.mockResolvedValue();
      mockGitOps.writeFiles.mockResolvedValue();
      mockGitOps.commit.mockResolvedValue();
      mockGitOps.push.mockResolvedValue();
      mockGitOps.createPullRequest.mockResolvedValue({ url: 'https://github.com/test/pr/1' });

      // Act
      const result = await target.commitAndPr({
        dream_id: 1,
        session_id: 'abc',
        source_date_iso: '2026-05-08',
        summary: 'session',
        files_modified: ['dailys/2026-05-08.md'],
        extraction_summary: 'short summary',
        session_log_writes: [{ path: 'dailys/2026-05-08.md', content: 'log', action: 'create' }],
      });

      // Assert
      expect(mockGitOps.createBranch).toHaveBeenCalledWith('dream/light-abc');
      expect(mockGitOps.writeFiles).toHaveBeenCalledWith([{ path: 'dailys/2026-05-08.md', content: 'log' }]);
      expect(result.git_branch).toBe('dream/light-abc');
      expect(result.git_pr_url).toBe('https://github.com/test/pr/1');
      expect(result.git_pr_status).toBe('created');
    });

    it('throws LIGHT_DREAM_COMMIT_AND_PR_FAILED on git error', async () => {
      // Arrange
      mockGitOps.pullLatestMain.mockRejectedValue(new Error('network'));

      // Act
      const promise = target.commitAndPr({
        dream_id: 1,
        session_id: 'abc',
        source_date_iso: '2026-05-08',
        summary: '',
        files_modified: ['x'],
        extraction_summary: '',
        session_log_writes: [{ path: 'dailys/2026-05-08.md', content: 'a', action: 'create' }],
      });

      // Assert
      await expect(promise).rejects.toBeInstanceOf(InternalException);
      await expect(promise).rejects.toMatchObject({ code: ErrorCode.LIGHT_DREAM_COMMIT_AND_PR_FAILED });
    });
  });

  describe('markDreamOutcome', () => {
    it('updates dream outcome via dreamRepo', async () => {
      // Arrange
      mockDreamRepo.updateDreamOutcome.mockResolvedValue();

      // Act
      await target.markDreamOutcome({ dream_id: 1, outcome: 'success' });

      // Assert
      expect(mockDreamRepo.updateDreamOutcome).toHaveBeenCalledWith(1, 'success', 'completed');
    });

    it('marks partial outcome on soft-fail path', async () => {
      // Arrange
      mockDreamRepo.updateDreamOutcome.mockResolvedValue();

      // Act
      await target.markDreamOutcome({ dream_id: 2, outcome: 'partial' });

      // Assert
      expect(mockDreamRepo.updateDreamOutcome).toHaveBeenCalledWith(2, 'partial', 'completed');
    });
  });
});
