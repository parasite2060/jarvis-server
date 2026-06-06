/**
 * Unit tests for `LightCommitAndPrActivity` (Story 13.10.5 / Q4 decomposition).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { LightCommitAndPrActivity } from './commit-and-pr.activity';
import { GitOpsService } from 'src/shared/git/git-ops.service';
import { AppConfigService } from 'src/shared/config/config.service';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import { PromptCacheService } from 'src/shared/agents/prompt-cache.service';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';

describe('LightCommitAndPrActivity', () => {
  let target: LightCommitAndPrActivity;
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
        LightCommitAndPrActivity,
        { provide: GitOpsService, useValue: mockGitOps },
        { provide: AppConfigService, useValue: mockConfig },
        { provide: DeepAgentFactory, useValue: mockAgentFactory },
        { provide: PromptCacheService, useValue: mockPromptCache },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(LightCommitAndPrActivity);
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
    mockGitOps.createPullRequest.mockResolvedValue({ url: 'https://github.com/test/pr/1' });

    await target.commitAndPr({
      dream_id: 1,
      session_id: 'abc',
      source_date_iso: '2026-05-08',
      summary: '',
      files_modified: ['dailys/2026-05-08.md'],
      extraction_summary: '',
      session_log_writes: [{ path: 'dailys/2026-05-08.md', content: 'log', action: 'create' }],
    });

    expect(mockGitOps.resetToCleanMain).toHaveBeenCalledTimes(1);
    // resetToCleanMain must be called before createBranch
    const resetOrder = mockGitOps.resetToCleanMain.mock.invocationCallOrder[0]!;
    const branchOrder = mockGitOps.createBranch.mock.invocationCallOrder[0]!;
    expect(resetOrder).toBeLessThan(branchOrder);
  });

  it('should return no_changes when session_log_writes is empty', async () => {
    const result = await target.commitAndPr({
      dream_id: 1,
      session_id: 's',
      source_date_iso: '2026-05-08',
      summary: 'sum',
      files_modified: [],
      extraction_summary: '',
      session_log_writes: [],
    });

    expect(result.git_pr_status).toBe('no_changes');
    expect(result.git_pr_url).toBeNull();
    expect(mockGitOps.createBranch).not.toHaveBeenCalled();
  });

  it('should write files and create PR on the new branch when session_log_writes has entries', async () => {
    mockGitOps.pullLatestMain.mockResolvedValue();
    mockGitOps.createBranch.mockResolvedValue();
    mockGitOps.writeFiles.mockResolvedValue();
    mockGitOps.commit.mockResolvedValue();
    mockGitOps.push.mockResolvedValue();
    mockGitOps.createPullRequest.mockResolvedValue({ url: 'https://github.com/test/pr/1' });

    const result = await target.commitAndPr({
      dream_id: 1,
      session_id: 'abc',
      source_date_iso: '2026-05-08',
      summary: 'session',
      files_modified: ['dailys/2026-05-08.md'],
      extraction_summary: 'short summary',
      session_log_writes: [{ path: 'dailys/2026-05-08.md', content: 'log', action: 'create' }],
    });

    expect(mockGitOps.createBranch).toHaveBeenCalledWith('dream/light-abc');
    expect(mockGitOps.writeFiles).toHaveBeenCalledWith([{ path: 'dailys/2026-05-08.md', content: 'log' }]);
    expect(result.git_branch).toBe('dream/light-abc');
    expect(result.git_pr_url).toBe('https://github.com/test/pr/1');
    expect(result.git_pr_status).toBe('created');
  });

  it('should not write audit file or annotate PR body when no conflict occurred (audits empty)', async () => {
    mockGitOps.pullLatestMain.mockResolvedValue();
    mockGitOps.createBranch.mockResolvedValue();
    mockGitOps.writeFiles.mockResolvedValue();
    mockGitOps.commit.mockResolvedValue();
    mockGitOps.push.mockResolvedValue();
    mockGitOps.createPullRequest.mockResolvedValue({ url: 'https://github.com/test/pr/1' });

    await target.commitAndPr({
      dream_id: 1,
      session_id: 'no-conflict',
      source_date_iso: '2026-05-08',
      summary: '',
      files_modified: ['dailys/2026-05-08.md'],
      extraction_summary: '',
      session_log_writes: [{ path: 'dailys/2026-05-08.md', content: 'x', action: 'create' }],
    });

    // push is called once (no second push for audit file)
    expect(mockGitOps.push).toHaveBeenCalledTimes(1);
    const prCall = mockGitOps.createPullRequest.mock.calls[0]![0];
    expect(prCall.body).not.toContain('⚠️');
  });

  it('should throw LIGHT_DREAM_COMMIT_AND_PR_FAILED when gitOps throws an error', async () => {
    mockGitOps.pullLatestMain.mockRejectedValue(new Error('network'));

    const promise = target.commitAndPr({
      dream_id: 1,
      session_id: 'abc',
      source_date_iso: '2026-05-08',
      summary: '',
      files_modified: ['x'],
      extraction_summary: '',
      session_log_writes: [{ path: 'dailys/2026-05-08.md', content: 'a', action: 'create' }],
    });

    await expect(promise).rejects.toBeInstanceOf(InternalException);
    await expect(promise).rejects.toMatchObject({ code: ErrorCode.LIGHT_DREAM_COMMIT_AND_PR_FAILED });
  });
});
