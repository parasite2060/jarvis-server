/**
 * GitOpsService — shared infrastructure facade for git ops backends.
 *
 * Delegates all primitives to a backend strategy resolved at call time from
 * `GitOpsBackendFactory`. Two backends are currently available:
 *   - `local`  — commit + merge only; no push, no PR.
 *   - `github` — commit + push + PR creation via `gh` CLI.
 *
 * Adding a new backend (e.g. gitlab, google-drive):
 *   1. Implement `IGitOpsBackend` in `backends/<name>.backend.ts`
 *   2. Add `NAME_GIT_OPS_BACKEND = Symbol('NAME_GIT_OPS_BACKEND')` token
 *   3. Add provider to `backends/index.ts`
 *   4. Register in `git.module.ts`
 *   5. Add 'name' to `MEMORY_STORAGE_MODE` Joi schema + config accessor
 */
import { Injectable } from '@nestjs/common';
import { GitOpsBackendFactory } from './git-ops-backend.factory';
import { IGitOpsBackend } from './backends/git-ops.backend';
import { AppConfigService } from 'src/shared/config/config.service';
import { CreatePullRequestOptions, CreatePullRequestResult, WriteFileChange } from './git-ops.types';

@Injectable()
export class GitOpsService {
  constructor(
    private readonly factory: GitOpsBackendFactory,
    private readonly appConfig: AppConfigService,
  ) {}

  private backend(): IGitOpsBackend {
    return this.factory.getBackend(this.appConfig.memoryStorageMode);
  }

  async pullLatestMain(): Promise<void> {
    return this.backend().pullLatestMain();
  }

  async createBranch(name: string): Promise<void> {
    return this.backend().createBranch(name);
  }

  async writeFiles(changes: WriteFileChange[]): Promise<void> {
    return this.backend().writeFiles(changes);
  }

  async commit(message: string, paths: string[]): Promise<void> {
    return this.backend().commit(message, paths);
  }

  async push(branch: string): Promise<void> {
    return this.backend().push(branch);
  }

  async createPullRequest(opts: CreatePullRequestOptions): Promise<CreatePullRequestResult> {
    return this.backend().createPullRequest(opts);
  }

  async mergeBranch(branch: string): Promise<void> {
    return this.backend().mergeBranch(branch);
  }
}
