import { Injectable, Logger } from '@nestjs/common';
import { GitOpsService } from 'src/shared/git/git-ops.service';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import { AppConfigService } from 'src/shared/config/config.service';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import { PromptCacheService } from 'src/shared/agents/prompt-cache.service';
import type { CommitAndPRResult, DeepCommitAndPRInput } from '../../workflows/deep-dream.workflow';
import { buildDeepPRBody } from './helpers';
import { buildConflictResolverCallback } from '../shared/build-conflict-resolver';
import { buildConflictAuditSection } from '../shared/conflict-audit';
import { conflictAwarePush } from '../shared/conflict-aware-push';

@Injectable()
export class DeepCommitAndPrActivity {
  private readonly logger = new Logger(DeepCommitAndPrActivity.name);

  constructor(
    private readonly gitOps: GitOpsService,
    private readonly config: AppConfigService,
    private readonly agentFactory: DeepAgentFactory,
    private readonly promptCache: PromptCacheService,
  ) {}

  @TemporalActivity('deep.commit_and_pr')
  async commitAndPr(inp: DeepCommitAndPRInput): Promise<CommitAndPRResult> {
    const branch = `dream/deep-${inp.target_date_iso}`;
    if (inp.vault_writes.length === 0 && inp.files_modified.length === 0) {
      return { git_branch: branch, git_pr_url: '', git_pr_status: 'no_files' };
    }

    const commitMsg = `dream(deep): consolidate ${inp.target_date_iso}`;

    try {
      await this.gitOps.pullLatestMain();
      await this.gitOps.createBranch(branch);
      const fileChanges = inp.vault_writes.map((t) => ({ path: t.path, content: t.content }));
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
        auditCommitPrefix: 'dream(deep):',
        resolverHandle: handle,
      });

      const prBody = buildDeepPRBody(inp) + buildConflictAuditSection(audits);
      const result = await this.gitOps.createPullRequest({
        branch,
        title: commitMsg,
        body: prBody,
        autoMerge,
      });

      this.logger.log({
        message: 'deep dream commit_and_pr completed',
        event: 'deepDream.commitAndPr.completed',
        dreamId: inp.dream_id,
        prUrl: result.url,
        status: 'created',
      });
      return { git_branch: branch, git_pr_url: result.url, git_pr_status: 'created' };
    } catch (err) {
      throw new InternalException(ErrorCode.DEEP_DREAM_COMMIT_AND_PR_FAILED, `commitAndPr failed: ${(err as Error).message}`);
    }
  }
}
