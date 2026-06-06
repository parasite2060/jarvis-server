import { buildConflictResolverCallback } from './build-conflict-resolver';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import type { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import type { PromptCacheService } from 'src/shared/agents/prompt-cache.service';

jest.mock('src/shared/git/read-auto-merge', () => ({
  readConflictConfig: jest.fn(),
}));

jest.mock('src/shared/git/conflict/resolve-conflict', () => ({
  resolveRebaseConflict: jest.fn(),
}));

jest.mock('src/modules/dream/agents/conflict-resolver.agent', () => ({
  buildConflictResolverAgent: jest.fn(),
}));

jest.mock('simple-git', () => jest.fn(() => ({})));

import { readConflictConfig } from 'src/shared/git/read-auto-merge';
import { resolveRebaseConflict } from 'src/shared/git/conflict/resolve-conflict';
import { buildConflictResolverAgent } from 'src/modules/dream/agents/conflict-resolver.agent';

const mockReadConflictConfig = readConflictConfig as jest.MockedFunction<typeof readConflictConfig>;
const mockResolveRebaseConflict = resolveRebaseConflict as jest.MockedFunction<typeof resolveRebaseConflict>;
const mockBuildConflictResolverAgent = buildConflictResolverAgent as jest.MockedFunction<typeof buildConflictResolverAgent>;

describe('buildConflictResolverCallback', () => {
  let mockAgentFactory: DeepMocked<DeepAgentFactory>;
  let mockPromptCache: DeepMocked<PromptCacheService>;

  beforeEach(() => {
    mockAgentFactory = createMock<DeepAgentFactory>();
    mockPromptCache = createMock<PromptCacheService>();
    mockPromptCache.getPrompt.mockReturnValue('system prompt content');
    jest.clearAllMocks();
  });

  it('returns a handle with resolver function and empty audits array', () => {
    const handle = buildConflictResolverCallback({
      vaultPath: '/vault',
      agentFactory: mockAgentFactory,
      promptCache: mockPromptCache,
    });

    expect(typeof handle.resolver).toBe('function');
    expect(handle.audits).toEqual([]);
  });

  describe('when aiConflictResolution is false (OFF path)', () => {
    beforeEach(() => {
      mockReadConflictConfig.mockResolvedValue({
        aiConflictResolution: false,
        allowGlobs: ['dailys/*'],
        protectedFiles: ['MEMORY.md'],
        autoMergeResolved: true,
      });
    });

    it('returns resolved:false without building an agent', async () => {
      const handle = buildConflictResolverCallback({
        vaultPath: '/vault',
        agentFactory: mockAgentFactory,
        promptCache: mockPromptCache,
      });

      const result = await handle.resolver(['dailys/2026-06-05.md']);

      expect(result).toEqual({ resolved: false });
      expect(mockBuildConflictResolverAgent).not.toHaveBeenCalled();
      expect(mockResolveRebaseConflict).not.toHaveBeenCalled();
    });

    it('leaves the audits array empty when feature is off', async () => {
      const handle = buildConflictResolverCallback({
        vaultPath: '/vault',
        agentFactory: mockAgentFactory,
        promptCache: mockPromptCache,
      });

      await handle.resolver(['dailys/2026-06-05.md']);

      expect(handle.audits).toHaveLength(0);
    });
  });

  describe('when aiConflictResolution is true (ON path)', () => {
    const oneAudit = {
      path: 'dailys/2026-06-05.md',
      base: 'base content',
      dream: 'dream content',
      main: 'main content',
      resolvedContent: 'resolved',
      reasoning: 'merged sensibly',
    };

    beforeEach(() => {
      mockReadConflictConfig.mockResolvedValue({
        aiConflictResolution: true,
        allowGlobs: ['dailys/*'],
        protectedFiles: ['MEMORY.md'],
        autoMergeResolved: true,
      });
      mockBuildConflictResolverAgent.mockReturnValue({
        usageLimits: { totalTokens: 1_500_000, toolCalls: 300 },
        outputSchema: {} as never,
        invoke: jest.fn(),
      });
      mockResolveRebaseConflict.mockResolvedValue({
        resolved: true,
        reason: null,
        resolvedFiles: ['dailys/2026-06-05.md'],
        skippedFiles: [],
        audits: [oneAudit],
      });
    });

    it('returns resolved:true when resolveRebaseConflict succeeds', async () => {
      const { resolver } = buildConflictResolverCallback({
        vaultPath: '/vault',
        agentFactory: mockAgentFactory,
        promptCache: mockPromptCache,
      });

      const result = await resolver(['dailys/2026-06-05.md']);

      expect(result).toEqual({ resolved: true });
    });

    it('populates audits with the results from resolveRebaseConflict', async () => {
      const { resolver, audits } = buildConflictResolverCallback({
        vaultPath: '/vault',
        agentFactory: mockAgentFactory,
        promptCache: mockPromptCache,
      });

      await resolver(['dailys/2026-06-05.md']);

      expect(audits).toHaveLength(1);
      expect(audits[0]).toEqual(oneAudit);
    });

    it('builds the agent using the prompt from promptCache', async () => {
      const { resolver } = buildConflictResolverCallback({
        vaultPath: '/vault',
        agentFactory: mockAgentFactory,
        promptCache: mockPromptCache,
      });

      await resolver(['dailys/2026-06-05.md']);

      expect(mockBuildConflictResolverAgent).toHaveBeenCalledWith(mockAgentFactory, {
        systemPrompt: 'system prompt content',
        usageLimits: { totalTokens: 1_500_000, toolCalls: 300 },
      });
    });
  });
});
