import type { GitOpsService } from 'src/shared/git/git-ops.service';
import type { AppConfigService } from 'src/shared/config/config.service';
import { readAutoMergeFromVault, readConflictConfig } from 'src/shared/git/read-auto-merge';
import { buildConflictAuditFile } from './conflict-audit';
import type { ConflictResolverHandle } from './build-conflict-resolver';
import type { ConflictResolutionAudit } from 'src/shared/git/conflict/resolve-conflict';

/**
 * Pushes the dream branch with AI conflict resolution. If a conflict was
 * AI-resolved, commits an audit file onto the branch and uses autoMergeResolved
 * for the merge decision; otherwise uses the normal auto_merge flag. Returns the
 * audits (for PR-body annotation) and the resolved auto-merge flag.
 */
export async function conflictAwarePush(deps: {
  gitOps: GitOpsService;
  config: AppConfigService;
  branch: string;
  auditCommitPrefix: string;
  resolverHandle: ConflictResolverHandle;
}): Promise<{ audits: ConflictResolutionAudit[]; autoMerge: boolean }> {
  await deps.gitOps.push(deps.branch, deps.resolverHandle.resolver);
  const { audits } = deps.resolverHandle;
  if (audits.length > 0) {
    const auditFile = buildConflictAuditFile(deps.branch, audits);
    await deps.gitOps.writeFiles([auditFile]);
    await deps.gitOps.commit(`${deps.auditCommitPrefix} conflict-resolution audit`, [auditFile.path]);
    await deps.gitOps.push(deps.branch);
  }
  const conflictConfig = await readConflictConfig(deps.config.vaultPath);
  const autoMerge = audits.length > 0 ? conflictConfig.autoMergeResolved : await readAutoMergeFromVault(deps.config.vaultPath);
  return { audits, autoMerge };
}
