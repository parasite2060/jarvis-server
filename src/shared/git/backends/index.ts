import { Provider } from '@nestjs/common';
import { LocalGitOpsBackend } from './local.backend';
import { GitHubGitOpsBackend } from './github.backend';
import { AppConfigService } from '../../config/config.service';

export const LOCAL_GIT_OPS_BACKEND = Symbol('LOCAL_GIT_OPS_BACKEND');
export const GITHUB_GIT_OPS_BACKEND = Symbol('GITHUB_GIT_OPS_BACKEND');

export const GitOpsBackendProviders: Provider[] = [
  {
    provide: LOCAL_GIT_OPS_BACKEND,
    useFactory: (config: AppConfigService) => new LocalGitOpsBackend(config.vaultPath),
    inject: [AppConfigService],
  },
  {
    provide: GITHUB_GIT_OPS_BACKEND,
    useFactory: (config: AppConfigService) => new GitHubGitOpsBackend(config.vaultPath, config.ghToken),
    inject: [AppConfigService],
  },
];
