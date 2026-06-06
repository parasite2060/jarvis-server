/**
 * Unit tests for `WeeklyCommitAndPrActivity` (Story 13.10.5 / Q4 decomposition).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { WeeklyCommitAndPrActivity } from './commit-and-pr.activity';
import { GitOpsService } from 'src/shared/git/git-ops.service';
import { AppConfigService } from 'src/shared/config/config.service';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import { PromptCacheService } from 'src/shared/agents/prompt-cache.service';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { ErrorCode } from 'src/utils/error.code';

describe('WeeklyCommitAndPrActivity', () => {
  let target: WeeklyCommitAndPrActivity;
  let mockGitOps: DeepMocked<GitOpsService>;
  let mockConfig: DeepMocked<AppConfigService>;
  let mockAgentFactory: DeepMocked<DeepAgentFactory>;
  let mockPromptCache: DeepMocked<PromptCacheService>;

  beforeEach(async () => {
    mockGitOps = createMock<GitOpsService>();
    mockConfig = createMock<AppConfigService>();
    mockAgentFactory = createMock<DeepAgentFactory>();
    mockPromptCache = createMock<PromptCacheService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WeeklyCommitAndPrActivity,
        { provide: GitOpsService, useValue: mockGitOps },
        { provide: AppConfigService, useValue: mockConfig },
        { provide: DeepAgentFactory, useValue: mockAgentFactory },
        { provide: PromptCacheService, useValue: mockPromptCache },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(WeeklyCommitAndPrActivity);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should call resetToCleanMain before createBranch on every dream to prevent dirty-tree PR failures', async () => {
    mockGitOps.resetToCleanMain.mockResolvedValue();
    mockGitOps.pullLatestMain.mockResolvedValue();
    mockGitOps.createBranch.mockResolvedValue();
    mockGitOps.writeFiles.mockResolvedValue();
    mockGitOps.commit.mockResolvedValue();
    mockGitOps.push.mockResolvedValue();
    mockGitOps.createPullRequest.mockResolvedValue({ url: 'https://github.com/x/y/pull/42' });

    await target.commitAndPr({
      dream_id: 12,
      week_iso: '2026-W19',
      files_modified: [{ path: 'reviews/2026-W19.md', action: 'create' }],
      vault_writes: [{ path: 'reviews/2026-W19.md', content: 'BODY', action: 'create' }],
    });

    expect(mockGitOps.resetToCleanMain).toHaveBeenCalledTimes(1);
    // resetToCleanMain must be called before createBranch
    const resetOrder = mockGitOps.resetToCleanMain.mock.invocationCallOrder[0]!;
    const branchOrder = mockGitOps.createBranch.mock.invocationCallOrder[0]!;
    expect(resetOrder).toBeLessThan(branchOrder);
  });

  it('should write files and create PR with correct body when vault_writes has entries', async () => {
    mockGitOps.createPullRequest.mockResolvedValue({ url: 'https://github.com/x/y/pull/42' });

    const result = await target.commitAndPr({
      dream_id: 12,
      week_iso: '2026-W19',
      files_modified: [{ path: 'reviews/2026-W19.md', action: 'create' }],
      vault_writes: [{ path: 'reviews/2026-W19.md', content: 'BODY', action: 'create' }],
    });

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
    // autoMerge is config-driven (DEFAULT_AUTO_MERGE=true when config.yml is absent).
    expect(prCall.autoMerge).toBe(true);
  });

  it('should return no_files when both files_modified and vault_writes are empty', async () => {
    const result = await target.commitAndPr({
      dream_id: 13,
      week_iso: '2026-W19',
      files_modified: [],
      vault_writes: [],
    });

    expect(result.git_pr_status).toBe('no_files');
    expect(mockGitOps.createBranch).not.toHaveBeenCalled();
  });

  it('should not write audit file or annotate PR body when no conflict occurred (audits empty)', async () => {
    mockGitOps.createPullRequest.mockResolvedValue({ url: 'https://github.com/x/y/pull/42' });

    await target.commitAndPr({
      dream_id: 12,
      week_iso: '2026-W19',
      files_modified: [{ path: 'reviews/2026-W19.md', action: 'create' }],
      vault_writes: [{ path: 'reviews/2026-W19.md', content: 'BODY', action: 'create' }],
    });

    // push is called once (no second push for audit file)
    expect(mockGitOps.push).toHaveBeenCalledTimes(1);
    const prCall = mockGitOps.createPullRequest.mock.calls[0]![0];
    expect(prCall.body).not.toContain('⚠️');
  });

  it('should throw WEEKLY_REVIEW_COMMIT_AND_PR_FAILED when gitOps throws an error', async () => {
    mockGitOps.pullLatestMain.mockRejectedValue(new Error('git failure'));

    const promise = target.commitAndPr({
      dream_id: 14,
      week_iso: '2026-W19',
      files_modified: [{ path: 'reviews/2026-W19.md', action: 'create' }],
      vault_writes: [{ path: 'reviews/2026-W19.md', content: 'B', action: 'create' }],
    });

    await expect(promise).rejects.toMatchObject({ code: ErrorCode.WEEKLY_REVIEW_COMMIT_AND_PR_FAILED });
  });
});
