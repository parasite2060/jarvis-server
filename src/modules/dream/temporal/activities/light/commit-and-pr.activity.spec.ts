/**
 * Unit tests for `LightCommitAndPrActivity` (Story 13.10.5 / Q4 decomposition).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { LightCommitAndPrActivity } from './commit-and-pr.activity';
import { GitOpsService } from 'src/shared/git/git-ops.service';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';

describe('LightCommitAndPrActivity', () => {
  let target: LightCommitAndPrActivity;
  let mockGitOps: DeepMocked<GitOpsService>;

  beforeEach(async () => {
    mockGitOps = createMock<GitOpsService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [LightCommitAndPrActivity, { provide: GitOpsService, useValue: mockGitOps }],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(LightCommitAndPrActivity);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

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
