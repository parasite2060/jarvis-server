import { Injectable, Logger } from '@nestjs/common';
import { GitOpsService } from 'src/shared/git/git-ops.service';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import type { CommitAndPRInput, CommitAndPRResult } from '../../workflows/light-dream.workflow';
import { buildPRBody } from './helpers';

@Injectable()
export class LightCommitAndPrActivity {
  private readonly logger = new Logger(LightCommitAndPrActivity.name);

  constructor(private readonly gitOps: GitOpsService) {}

  @TemporalActivity('light.commit_and_pr')
  async commitAndPr(inp: CommitAndPRInput): Promise<CommitAndPRResult> {
    if (inp.session_log_writes.length === 0) {
      return { git_branch: '', git_pr_url: null, git_pr_status: 'no_changes' };
    }

    const branch = `dream/light-${inp.session_id}`;
    const commitMsg = `dream(light): extract session ${inp.source_date_iso}`;
    const prBody = buildPRBody(inp);

    try {
      await this.gitOps.pullLatestMain();
      await this.gitOps.createBranch(branch);
      const fileChanges = inp.session_log_writes.map((t) => ({ path: t.path, content: t.content }));
      await this.gitOps.writeFiles(fileChanges);
      await this.gitOps.commit(
        commitMsg,
        fileChanges.map((f) => f.path),
      );
      await this.gitOps.push(branch);
      const result = await this.gitOps.createPullRequest({
        branch,
        title: commitMsg,
        body: prBody,
        autoMerge: false,
      });

      this.logger.log({
        message: 'light dream commit_and_pr completed',
        event: 'lightDream.commitAndPr.completed',
        dreamId: inp.dream_id,
        prUrl: result.url,
        status: 'created',
      });

      return { git_branch: branch, git_pr_url: result.url, git_pr_status: 'created' };
    } catch (err) {
      throw new InternalException(ErrorCode.LIGHT_DREAM_COMMIT_AND_PR_FAILED, `commitAndPr failed: ${(err as Error).message}`);
    }
  }
}
