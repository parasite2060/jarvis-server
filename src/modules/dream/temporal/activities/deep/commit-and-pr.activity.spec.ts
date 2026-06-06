/**
 * Unit tests for `DeepCommitAndPrActivity` (CR-6 wiring).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { DeepCommitAndPrActivity } from './commit-and-pr.activity';
import { GitOpsService } from 'src/shared/git/git-ops.service';
import { AppConfigService } from 'src/shared/config/config.service';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import { PromptCacheService } from 'src/shared/agents/prompt-cache.service';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { ErrorCode } from 'src/utils/error.code';

describe('DeepCommitAndPrActivity', () => {
  let target: DeepCommitAndPrActivity;
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
        DeepCommitAndPrActivity,
        { provide: GitOpsService, useValue: mockGitOps },
        { provide: AppConfigService, useValue: mockConfig },
        { provide: DeepAgentFactory, useValue: mockAgentFactory },
        { provide: PromptCacheService, useValue: mockPromptCache },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(DeepCommitAndPrActivity);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return no_files when both vault_writes and files_modified are empty', async () => {
    const result = await target.commitAndPr({
      dream_id: 1,
      target_date_iso: '2026-05-08',
      files_modified: [],
      vault_writes: [],
      stats: {},
    });

    expect(result.git_pr_status).toBe('no_files');
    expect(mockGitOps.createBranch).not.toHaveBeenCalled();
  });

  it('should write files and create PR when vault_writes has entries', async () => {
    mockGitOps.pullLatestMain.mockResolvedValue();
    mockGitOps.createBranch.mockResolvedValue();
    mockGitOps.writeFiles.mockResolvedValue();
    mockGitOps.commit.mockResolvedValue();
    mockGitOps.push.mockResolvedValue();
    mockGitOps.createPullRequest.mockResolvedValue({ url: 'https://github.com/test/pr/2' });

    const result = await target.commitAndPr({
      dream_id: 2,
      target_date_iso: '2026-05-08',
      files_modified: [{ path: 'decisions/d.md', action: 'create' }],
      vault_writes: [{ path: 'decisions/d.md', content: 'body', action: 'create' }],
      stats: { total_memories_processed: 5 },
    });

    expect(result.git_branch).toBe('dream/deep-2026-05-08');
    expect(result.git_pr_url).toBe('https://github.com/test/pr/2');
    expect(result.git_pr_status).toBe('created');
    expect(mockGitOps.createBranch).toHaveBeenCalledWith('dream/deep-2026-05-08');
  });

  it('should not write audit file or annotate PR body when no conflict occurred (audits empty)', async () => {
    mockGitOps.pullLatestMain.mockResolvedValue();
    mockGitOps.createBranch.mockResolvedValue();
    mockGitOps.writeFiles.mockResolvedValue();
    mockGitOps.commit.mockResolvedValue();
    mockGitOps.push.mockResolvedValue();
    mockGitOps.createPullRequest.mockResolvedValue({ url: 'https://github.com/test/pr/2' });

    await target.commitAndPr({
      dream_id: 2,
      target_date_iso: '2026-05-08',
      files_modified: [{ path: 'decisions/d.md', action: 'create' }],
      vault_writes: [{ path: 'decisions/d.md', content: 'body', action: 'create' }],
      stats: {},
    });

    expect(mockGitOps.push).toHaveBeenCalledTimes(1);
    const prCall = mockGitOps.createPullRequest.mock.calls[0]![0];
    expect(prCall.body).not.toContain('⚠️');
  });

  it('should throw DEEP_DREAM_COMMIT_AND_PR_FAILED when gitOps throws', async () => {
    mockGitOps.pullLatestMain.mockRejectedValue(new Error('git failure'));

    const promise = target.commitAndPr({
      dream_id: 3,
      target_date_iso: '2026-05-08',
      files_modified: [{ path: 'decisions/d.md', action: 'create' }],
      vault_writes: [{ path: 'decisions/d.md', content: 'body', action: 'create' }],
      stats: {},
    });

    await expect(promise).rejects.toMatchObject({ code: ErrorCode.DEEP_DREAM_COMMIT_AND_PR_FAILED });
  });
});
