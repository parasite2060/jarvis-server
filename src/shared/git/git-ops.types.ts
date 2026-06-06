/**
 * Public types for the GitOpsService surface (Story 13.7).
 *
 * Per `design/git-ops.md §2` — six low-level idempotent primitives consumed by
 * dream commit-and-pr activities (Stories 13.10/13.11/13.12). Callers
 * construct branch names + commit messages from frozen templates per
 * architecture §6.5; this service operates on whatever it receives.
 */

export interface WriteFileChange {
  path: string;
  content: string;
}

export interface CreatePullRequestOptions {
  branch: string;
  title: string;
  body: string;
  autoMerge: boolean;
}

export interface CreatePullRequestResult {
  url: string;
}

/**
 * Optional hook invoked by the backend when a rebase conflict occurs during
 * push recovery. Given the conflicted file paths, it attempts resolution
 * (e.g. AI-assisted) and stages the resolved files. Returns whether EVERY
 * conflicted file was resolved (so the backend can `git rebase --continue`).
 * When absent, or when it returns resolved=false, the backend aborts the
 * rebase and throws GitOpsRebaseConflictError as before.
 */
export type ConflictResolver = (conflictedFiles: string[]) => Promise<{ resolved: boolean }>;
