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
