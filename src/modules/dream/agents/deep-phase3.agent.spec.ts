import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { buildPhase3Agent } from './deep-phase3.agent';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import { ConsolidationOutputSchema } from './consolidation-output.schema';

describe('buildPhase3Agent', () => {
  let mockFactory: DeepMocked<DeepAgentFactory>;

  beforeEach(() => {
    mockFactory = createMock<DeepAgentFactory>();
    mockFactory.create.mockReturnValue({
      usageLimits: { totalTokens: 1, toolCalls: 1 },
      outputSchema: ConsolidationOutputSchema,
      invoke: async () => ({
        memory_md: 'x',
        daily_summary: 'y',
        stats: { total_memories_processed: 0, duplicates_removed: 0, contradictions_resolved: 0, patterns_promoted: 0, stale_pruned: 0 },
        vault_updates: { decisions: [], projects: [], patterns: [], templates: [], concepts: [], connections: [], lessons: [], topics: [] },
        vault_writes: [],
      }),
    });
  });

  it('calls factory.create with ConsolidationOutputSchema and 10 tools (base 7 + queryMemu + readDailyLog live + readVaultIndex)', () => {
    buildPhase3Agent(mockFactory, {
      systemPrompt: 'TEST',
      toolDeps: { vaultPath: '/tmp/v', memuApi: createMock() },
      memuMemories: [],
      vaultRoot: '/tmp/v',
      usageLimits: { totalTokens: 100, toolCalls: 10 },
    });

    expect(mockFactory.create).toHaveBeenCalledTimes(1);
    const args = mockFactory.create.mock.calls[0]![0];
    expect(args.output).toBe(ConsolidationOutputSchema);
    expect(args.tools).toHaveLength(10);
  });
});
