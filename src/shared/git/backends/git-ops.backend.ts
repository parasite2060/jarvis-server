import { CreatePullRequestOptions, CreatePullRequestResult, WriteFileChange } from '../git-ops.types';

export const GIT_OPS_BACKEND_MODE = Symbol('GIT_OPS_BACKEND_MODE') as unknown;

export interface IGitOpsBackend {
  readonly mode: 'local' | 'github';

  pullLatestMain(): Promise<void>;
  createBranch(name: string): Promise<void>;
  writeFiles(changes: WriteFileChange[]): Promise<void>;
  commit(message: string, paths: string[]): Promise<void>;
  push(branch: string): Promise<void>;
  createPullRequest(opts: CreatePullRequestOptions): Promise<CreatePullRequestResult>;
  mergeBranch(branch: string): Promise<void>;
  fetchOriginMain(): Promise<void>;
}
