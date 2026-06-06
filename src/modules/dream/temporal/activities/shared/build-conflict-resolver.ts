import simpleGit from 'simple-git';
import type { ConflictResolver } from 'src/shared/git/git-ops.types';
import { readConflictConfig } from 'src/shared/git/read-auto-merge';
import { resolveRebaseConflict, type ConflictResolutionAudit } from 'src/shared/git/conflict/resolve-conflict';
import { buildConflictResolverAgent } from 'src/modules/dream/agents/conflict-resolver.agent';
import type { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import type { PromptCacheService } from 'src/shared/agents/prompt-cache.service';

export interface ConflictResolverHandle {
  resolver: ConflictResolver;
  audits: ConflictResolutionAudit[];
}

export function buildConflictResolverCallback(deps: {
  vaultPath: string;
  agentFactory: DeepAgentFactory;
  promptCache: PromptCacheService;
}): ConflictResolverHandle {
  const audits: ConflictResolutionAudit[] = [];
  const resolver: ConflictResolver = async (conflictedFiles) => {
    const config = await readConflictConfig(deps.vaultPath);
    if (!config.aiConflictResolution) {
      return { resolved: false };
    }
    const agent = buildConflictResolverAgent(deps.agentFactory, {
      systemPrompt: deps.promptCache.getPrompt('conflict-resolution'),
      usageLimits: { totalTokens: 1_500_000, toolCalls: 300 },
    });
    const git = simpleGit({ baseDir: deps.vaultPath });
    const result = await resolveRebaseConflict({ git, vaultPath: deps.vaultPath, conflictedFiles, agent, config });
    audits.push(...result.audits);
    return { resolved: result.resolved };
  };
  return { resolver, audits };
}
