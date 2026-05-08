/**
 * Typed errors for `GitOpsService` (Story 13.7).
 *
 * The story spec calls this `GitOpsRebaseConflictError extends ApplicationError`,
 * but the inherited boilerplate uses `InternalException` (extends `BaseException`)
 * for codeful errors — there is no `ApplicationError` class in this codebase
 * (Story 13.6 confirmed via `MemuError` / `MemuUnavailableError` / vault errors).
 * We mirror the existing pattern: extend `InternalException` so the global
 * `DefaultInternalExceptionFilter` (Story 13.1) catches it and emits the
 * boilerplate-flat envelope (Decision B). The carry-forward semantic is
 * preserved — the dream activities that consume this (Stories 13.10/13.11/13.12)
 * see a typed error with `branch` + `conflictedFiles` for the
 * `dream_phases.output_json.gitOps` payload (per design/git-ops.md §5.3).
 */
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';

export class GitOpsRebaseConflictError extends InternalException {
  public readonly branch: string;
  public readonly conflictedFiles: string[];

  constructor(branch: string, conflictedFiles: string[]) {
    const filesPreview = conflictedFiles.length > 0 ? conflictedFiles.join(', ') : 'unknown';
    super(ErrorCode.GIT_OPS_REBASE_CONFLICT, `git rebase produced conflicts on branch '${branch}': ${filesPreview}`);
    this.name = 'GitOpsRebaseConflictError';
    this.branch = branch;
    this.conflictedFiles = conflictedFiles;
  }
}
