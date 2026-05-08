/**
 * Unit tests for `WeeklyReviewActivities` (Story 13.12 / Task 16).
 *
 * AAA + `@golevelup/ts-jest` `createMock` for every constructor dependency.
 * Same shape as 13.10/13.11 specs.
 */
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { CommandBus } from '@nestjs/cqrs';
import { ApplicationFailure } from '@temporalio/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { WeeklyReviewActivities } from './weekly-review.activities';
import { GitOpsService } from 'src/shared/git/git-ops.service';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import { PromptCacheService } from 'src/shared/agents/prompt-cache.service';
import { AppConfigService } from 'src/shared/config/config.service';
import { DREAM_REPOSITORY, IDreamRepository } from 'src/shared/domain/repositories/dream.repository.interface';
import { DREAM_PHASE_REPOSITORY, IDreamPhaseRepository } from 'src/shared/domain/repositories/dream-phase.repository.interface';
import { MEMU_API, IMemuApi } from 'src/shared/domain/apis/memu-api.interface';
import { DBConnections } from 'src/shared/postgres/utils/constaint';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { InvalidateContextCacheCommand } from 'src/modules/context/commands/invalidate-context-cache.command';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import { WeeklyReviewOutputSchema } from '../../../agents/schemas/weekly-review-output.schema';

jest.mock('deepagents', () => ({
  createDeepAgent: jest.fn().mockReturnValue({ invoke: jest.fn() }),
}));

describe('WeeklyReviewActivities', () => {
  let target: WeeklyReviewActivities;
  let mockMemuApi: DeepMocked<IMemuApi>;
  let mockGitOps: DeepMocked<GitOpsService>;
  let mockAgentFactory: DeepMocked<DeepAgentFactory>;
  let mockPromptCache: DeepMocked<PromptCacheService>;
  let mockDreamRepo: DeepMocked<IDreamRepository>;
  let mockPhaseRepo: DeepMocked<IDreamPhaseRepository>;
  let mockDataSource: DeepMocked<DataSource>;
  let mockCommandBus: DeepMocked<CommandBus>;
  let mockConfig: DeepMocked<AppConfigService>;
  let vaultRoot: string;

  beforeEach(async () => {
    mockMemuApi = createMock<IMemuApi>();
    mockGitOps = createMock<GitOpsService>();
    mockAgentFactory = createMock<DeepAgentFactory>();
    mockPromptCache = createMock<PromptCacheService>();
    mockDreamRepo = createMock<IDreamRepository>();
    mockPhaseRepo = createMock<IDreamPhaseRepository>();
    mockDataSource = createMock<DataSource>();
    mockCommandBus = createMock<CommandBus>();
    mockConfig = createMock<AppConfigService>();
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weekly-vault-'));

    Object.defineProperty(mockConfig, 'vaultPath', { configurable: true, get: () => vaultRoot });
    Object.defineProperty(mockConfig, 'weeklyReviewLimits', {
      configurable: true,
      get: () => ({ maxTokens: 1_500_000, maxIterations: 300 }),
    });

    mockPromptCache.getPrompt.mockReturnValue('weekly-review-prompt');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WeeklyReviewActivities,
        { provide: MEMU_API, useValue: mockMemuApi },
        { provide: GitOpsService, useValue: mockGitOps },
        { provide: DeepAgentFactory, useValue: mockAgentFactory },
        { provide: PromptCacheService, useValue: mockPromptCache },
        { provide: DREAM_REPOSITORY, useValue: mockDreamRepo },
        { provide: DREAM_PHASE_REPOSITORY, useValue: mockPhaseRepo },
        { provide: getDataSourceToken(DBConnections.INTERNAL), useValue: mockDataSource },
        { provide: CommandBus, useValue: mockCommandBus },
        { provide: AppConfigService, useValue: mockConfig },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(WeeklyReviewActivities);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await fs.rm(vaultRoot, { recursive: true, force: true }).catch(() => {});
  });

  // ---------------------------------------------------------------------------
  // gatherDailys
  // ---------------------------------------------------------------------------
  describe('gatherDailys', () => {
    it('creates Dream row, reads 7 dailys, returns daily_logs map', async () => {
      // Arrange
      const dailysDir = path.join(vaultRoot, 'dailys');
      await fs.mkdir(dailysDir, { recursive: true });
      await fs.writeFile(path.join(dailysDir, '2026-05-04.md'), 'Mon');
      await fs.writeFile(path.join(dailysDir, '2026-05-06.md'), 'Wed');

      const fakeDream = { id: 42, type: 'weekly_review', status: 'processing' };
      const queryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      const repo = {
        createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
        create: jest.fn().mockReturnValue(fakeDream),
        save: jest.fn().mockResolvedValue(fakeDream),
      };
      mockDataSource.transaction.mockImplementation(async (cb: unknown) => {
        return (cb as (m: unknown) => Promise<unknown>)({ getRepository: jest.fn().mockReturnValue(repo) });
      });

      // Act
      const result = await target.gatherDailys({ week_start: '2026-05-04', trigger: 'auto' });

      // Assert
      expect(result.dream_id).toBe(42);
      expect(result.week_start).toBe('2026-05-04');
      expect(result.daily_logs).toEqual({ '2026-05-04': 'Mon', '2026-05-06': 'Wed' });
      expect(repo.save).toHaveBeenCalled();
    });

    it('returns existing dream id when dedup hits within 60s window', async () => {
      // Arrange
      const dailysDir = path.join(vaultRoot, 'dailys');
      await fs.mkdir(dailysDir, { recursive: true });
      await fs.writeFile(path.join(dailysDir, '2026-05-04.md'), 'Mon');

      const queryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 99 }),
      };
      const repo = { createQueryBuilder: jest.fn().mockReturnValue(queryBuilder), create: jest.fn(), save: jest.fn() };
      mockDataSource.transaction.mockImplementation(async (cb: unknown) => {
        return (cb as (m: unknown) => Promise<unknown>)({ getRepository: jest.fn().mockReturnValue(repo) });
      });

      // Act
      const result = await target.gatherDailys({ week_start: '2026-05-04' });

      // Assert
      expect(result.dream_id).toBe(99);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('raises ApplicationFailure.nonRetryable on empty week (Q5)', async () => {
      // Arrange — no dailys/ directory; dream insert succeeds.
      const fakeDream = { id: 7 };
      const queryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      const repo = {
        createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
        create: jest.fn().mockReturnValue(fakeDream),
        save: jest.fn().mockResolvedValue(fakeDream),
      };
      mockDataSource.transaction.mockImplementation(async (cb: unknown) => {
        return (cb as (m: unknown) => Promise<unknown>)({ getRepository: jest.fn().mockReturnValue(repo) });
      });

      // Act + Assert
      await expect(target.gatherDailys({ week_start: '2026-05-04' })).rejects.toBeInstanceOf(ApplicationFailure);
    });

    it('throws on invalid week_start ISO date', async () => {
      // Arrange
      const fakeDream = { id: 8 };
      const queryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      const repo = {
        createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
        create: jest.fn().mockReturnValue(fakeDream),
        save: jest.fn().mockResolvedValue(fakeDream),
      };
      mockDataSource.transaction.mockImplementation(async (cb: unknown) => {
        return (cb as (m: unknown) => Promise<unknown>)({ getRepository: jest.fn().mockReturnValue(repo) });
      });

      // Act + Assert
      await expect(target.gatherDailys({ week_start: 'not-a-date' })).rejects.toBeInstanceOf(InternalException);
    });
  });

  // ---------------------------------------------------------------------------
  // gatherIndexes
  // ---------------------------------------------------------------------------
  describe('gatherIndexes', () => {
    it('reads 6 folder _index.md + _guide.md', async () => {
      // Arrange
      for (const folder of ['decisions', 'patterns', 'concepts']) {
        await fs.mkdir(path.join(vaultRoot, folder), { recursive: true });
        await fs.writeFile(path.join(vaultRoot, folder, '_index.md'), `idx-${folder}`);
      }
      await fs.writeFile(path.join(vaultRoot, '_guide.md'), 'guide-body');

      // Act
      const result = await target.gatherIndexes({ dream_id: 1, week_start: '2026-05-04' });

      // Assert
      expect(result.vault_indexes).toEqual({ decisions: 'idx-decisions', patterns: 'idx-patterns', concepts: 'idx-concepts' });
      expect(result.vault_guide).toBe('guide-body');
    });

    it('returns empty vault_guide when missing', async () => {
      // Act
      const result = await target.gatherIndexes({ dream_id: 1, week_start: '2026-05-04' });

      // Assert
      expect(result.vault_guide).toBe('');
      expect(result.vault_indexes).toEqual({});
    });
  });

  // ---------------------------------------------------------------------------
  // runWeeklyReviewAgent
  // ---------------------------------------------------------------------------
  describe('runWeeklyReviewAgent', () => {
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

  // ---------------------------------------------------------------------------
  // writeReviewFile
  // ---------------------------------------------------------------------------
  describe('writeReviewFile', () => {
    it('returns triple with frontmatter + body, no disk write', async () => {
      // Act
      const result = await target.writeReviewFile({
        dream_id: 8,
        week_start: '2026-05-04',
        review_content: '# Weekly Review: 2026-W19\n\nbody',
      });

      // Assert
      expect(result.review_path).toBe('reviews/2026-W19.md');
      expect(result.files_modified).toEqual([{ path: 'reviews/2026-W19.md', action: 'create' }]);
      expect(result.vault_writes).toHaveLength(1);
      expect(result.vault_writes[0]!.path).toBe('reviews/2026-W19.md');
      expect(result.vault_writes[0]!.content).toContain('---\ntype: review\ntags: [review, weekly]\ncreated: 2026-05-04\nweek: 2026-W19\n---\n');
      expect(result.vault_writes[0]!.content).toContain('# Weekly Review: 2026-W19\n\nbody');
      expect(result.vault_writes[0]!.action).toBe('create');
    });
  });

  // ---------------------------------------------------------------------------
  // commitAndPr
  // ---------------------------------------------------------------------------
  describe('commitAndPr', () => {
    it('writes triples on new branch, creates PR with byte-equivalent body', async () => {
      // Arrange
      mockGitOps.createPullRequest.mockResolvedValue({ url: 'https://github.com/x/y/pull/42' });

      // Act
      const result = await target.commitAndPr({
        dream_id: 12,
        week_iso: '2026-W19',
        files_modified: [{ path: 'reviews/2026-W19.md', action: 'create' }],
        vault_writes: [{ path: 'reviews/2026-W19.md', content: 'BODY', action: 'create' }],
      });

      // Assert
      expect(result.git_branch).toBe('dream/review-2026-W19');
      expect(result.git_pr_url).toBe('https://github.com/x/y/pull/42');
      expect(result.git_pr_status).toBe('created');
      expect(mockGitOps.createBranch).toHaveBeenCalledWith('dream/review-2026-W19');
      expect(mockGitOps.writeFiles).toHaveBeenCalledWith([{ path: 'reviews/2026-W19.md', content: 'BODY' }]);
      expect(mockGitOps.commit).toHaveBeenCalledWith('dream(weekly): review 2026-W19', ['reviews/2026-W19.md']);
      const prCall = mockGitOps.createPullRequest.mock.calls[0]![0];
      expect(prCall.title).toBe('dream(weekly): review 2026-W19');
      expect(prCall.body).toContain('## Weekly Review');
      expect(prCall.body).toContain('**Dream ID:** 12');
      expect(prCall.body).toContain('**Week:** 2026-W19');
      expect(prCall.body).toContain('- `reviews/2026-W19.md`');
      expect(prCall.autoMerge).toBe(false);
    });

    it('returns no_files when both files_modified and vault_writes empty', async () => {
      // Act
      const result = await target.commitAndPr({
        dream_id: 13,
        week_iso: '2026-W19',
        files_modified: [],
        vault_writes: [],
      });

      // Assert
      expect(result.git_pr_status).toBe('no_files');
      expect(mockGitOps.createBranch).not.toHaveBeenCalled();
    });

    it('throws WEEKLY_REVIEW_COMMIT_AND_PR_FAILED on gitOps error', async () => {
      // Arrange
      mockGitOps.pullLatestMain.mockRejectedValue(new Error('git failure'));

      // Act
      const promise = target.commitAndPr({
        dream_id: 14,
        week_iso: '2026-W19',
        files_modified: [{ path: 'reviews/2026-W19.md', action: 'create' }],
        vault_writes: [{ path: 'reviews/2026-W19.md', content: 'B', action: 'create' }],
      });

      // Assert
      await expect(promise).rejects.toMatchObject({ code: ErrorCode.WEEKLY_REVIEW_COMMIT_AND_PR_FAILED });
    });
  });

  // ---------------------------------------------------------------------------
  // invalidateContextCache (TS-only — Q3)
  // ---------------------------------------------------------------------------
  describe('invalidateContextCache', () => {
    it('dispatches InvalidateContextCacheCommand with weekly-review-completed reason', async () => {
      // Act
      await target.invalidateContextCache({ dream_id: 20 });

      // Assert
      expect(mockCommandBus.execute).toHaveBeenCalledTimes(1);
      const cmd = mockCommandBus.execute.mock.calls[0]![0] as InvalidateContextCacheCommand;
      expect(cmd).toBeInstanceOf(InvalidateContextCacheCommand);
      expect(cmd.payload.reason).toBe('weekly-review-completed');
      expect(cmd.payload.timestamp).toBeInstanceOf(Date);
    });

    it('throws WEEKLY_REVIEW_INVALIDATE_CACHE_FAILED on CommandBus error', async () => {
      // Arrange
      mockCommandBus.execute.mockRejectedValue(new Error('bus down'));

      // Act
      const promise = target.invalidateContextCache({ dream_id: 21 });

      // Assert
      await expect(promise).rejects.toMatchObject({ code: ErrorCode.WEEKLY_REVIEW_INVALIDATE_CACHE_FAILED });
    });
  });

  // ---------------------------------------------------------------------------
  // markWeeklyReviewOutcome (TS-only — Q8)
  // ---------------------------------------------------------------------------
  describe('markWeeklyReviewOutcome', () => {
    it("delegates to dreamRepo.updateDreamOutcome with status='completed'", async () => {
      // Act
      await target.markWeeklyReviewOutcome({ dream_id: 30, outcome: 'completed' });

      // Assert
      expect(mockDreamRepo.updateDreamOutcome).toHaveBeenCalledWith(30, 'completed', 'completed');
    });

    it('throws WEEKLY_REVIEW_OUTCOME_UPDATE_FAILED on repo error', async () => {
      // Arrange
      mockDreamRepo.updateDreamOutcome.mockRejectedValue(new Error('db down'));

      // Act
      const promise = target.markWeeklyReviewOutcome({ dream_id: 31, outcome: 'partial' });

      // Assert
      await expect(promise).rejects.toMatchObject({ code: ErrorCode.WEEKLY_REVIEW_OUTCOME_UPDATE_FAILED });
    });
  });
});
