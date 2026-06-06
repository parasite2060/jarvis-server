import { Injectable, Logger } from '@nestjs/common';
import { GitOpsService } from 'src/shared/git/git-ops.service';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import { AppConfigService } from 'src/shared/config/config.service';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import { PromptCacheService } from 'src/shared/agents/prompt-cache.service';
import type { CommitAndPRInput, CommitAndPRResult } from '../../workflows/light-dream.workflow';
import { buildPRBody } from './helpers';
import { buildConflictResolverCallback } from '../shared/build-conflict-resolver';
import { buildConflictAuditSection } from '../shared/conflict-audit';
import { conflictAwarePush } from '../shared/conflict-aware-push';

@Injectable()
export class LightCommitAndPrActivity {
  private readonly logger = new Logger(LightCommitAndPrActivity.name);

  constructor(
    private readonly gitOps: GitOpsService,
    private readonly config: AppConfigService,
    private readonly agentFactory: DeepAgentFactory,
    private readonly promptCache: PromptCacheService,
  ) {}

  @TemporalActivity('light.commit_and_pr')
  async commitAndPr(inp: CommitAndPRInput): Promise<CommitAndPRResult> {
    if (inp.session_log_writes.length === 0) {
      return { git_branch: '', git_pr_url: null, git_pr_status: 'no_changes' };
    }

    const branch = `dream/light-${inp.session_id}`;
    const commitMsg = `dream(light): extract session ${inp.source_date_iso}`;

    try {
      await this.gitOps.pullLatestMain();
      await this.gitOps.createBranch(branch);
      const fileChanges = inp.session_log_writes.map((t) => ({ path: t.path, content: t.content }));
      await this.gitOps.writeFiles(fileChanges);
      await this.gitOps.commit(
        commitMsg,
        fileChanges.map((f) => f.path),
      );

      const handle = buildConflictResolverCallback({
        vaultPath: this.config.vaultPath,
        agentFactory: this.agentFactory,
        promptCache: this.promptCache,
      });
      const { audits, autoMerge } = await conflictAwarePush({
        gitOps: this.gitOps,
        config: this.config,
        branch,
        auditCommitPrefix: 'dream(light):',
        resolverHandle: handle,
      });

      const prBody = buildPRBody(inp) + buildConflictAuditSection(audits);
      const result = await this.gitOps.createPullRequest({
        branch,
        title: commitMsg,
        body: prBody,
        autoMerge,
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
