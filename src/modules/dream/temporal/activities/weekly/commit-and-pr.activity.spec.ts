/**
 * Unit tests for `WeeklyCommitAndPrActivity` (Story 13.10.5 / Q4 decomposition).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { WeeklyCommitAndPrActivity } from './commit-and-pr.activity';
import { GitOpsService } from 'src/shared/git/git-ops.service';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { ErrorCode } from 'src/utils/error.code';

describe('WeeklyCommitAndPrActivity', () => {
  let target: WeeklyCommitAndPrActivity;
  let mockGitOps: DeepMocked<GitOpsService>;

  beforeEach(async () => {
    mockGitOps = createMock<GitOpsService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [WeeklyCommitAndPrActivity, { provide: GitOpsService, useValue: mockGitOps }],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(WeeklyCommitAndPrActivity);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should write triples and create PR with correct body when vault_writes has entries', async () => {
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

  it('should return no_files when both files_modified and vault_writes are empty', async () => {
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

  it('should throw WEEKLY_REVIEW_COMMIT_AND_PR_FAILED when gitOps throws an error', async () => {
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
