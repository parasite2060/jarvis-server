import type { SimpleGit } from 'simple-git';
import type { ConflictResolver } from '../git-ops.types';
import { GitOpsRebaseConflictError } from '../errors';

/**
 * Shared rebase-conflict handling for the git backends. Given the conflicted
 * files and an optional resolver: if the resolver resolves everything, finish
 * the rebase (editor-less `--continue`); otherwise — or if the resolver/continue
 * fails — abort the rebase and throw GitOpsRebaseConflictError. Returns nothing
 * on success; throws on any unresolved/failed path. Keeps the backend agent-free.
 */
export async function applyConflictResolverOrThrow(
  git: SimpleGit,
  branch: string,
  conflictedFiles: string[],
  resolver: ConflictResolver | undefined,
): Promise<void> {
  if (resolver !== undefined && conflictedFiles.length > 0) {
    const outcome = await resolver(conflictedFiles);
    if (outcome.resolved) {
      try {
        // core.editor=true suppresses the interactive editor when git writes the rebase commit message (would otherwise hang).
        await git.raw(['-c', 'core.editor=true', 'rebase', '--continue']);
        return;
      } catch {
        await git.rebase(['--abort']).catch(() => undefined);
        throw new GitOpsRebaseConflictError(branch, conflictedFiles);
      }
    }
  }
  await git.rebase(['--abort']).catch(() => undefined);
  throw new GitOpsRebaseConflictError(branch, conflictedFiles);
}
