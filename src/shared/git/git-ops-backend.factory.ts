import { Inject, Injectable } from '@nestjs/common';
import { IGitOpsBackend } from './backends/git-ops.backend';
import { LOCAL_GIT_OPS_BACKEND, GITHUB_GIT_OPS_BACKEND } from './backends/index';

export { LOCAL_GIT_OPS_BACKEND, GITHUB_GIT_OPS_BACKEND };

@Injectable()
export class GitOpsBackendFactory {
  private readonly backends: Map<'local' | 'github', IGitOpsBackend>;

  constructor(@Inject(LOCAL_GIT_OPS_BACKEND) local: IGitOpsBackend, @Inject(GITHUB_GIT_OPS_BACKEND) github: IGitOpsBackend) {
    this.backends = new Map([
      ['local', local],
      ['github', github],
    ]);
  }

  getBackend(mode: 'local' | 'github'): IGitOpsBackend {
    return this.backends.get(mode) ?? this.backends.get('local')!;
  }
}
