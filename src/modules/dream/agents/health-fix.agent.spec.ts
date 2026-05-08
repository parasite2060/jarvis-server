import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { buildHealthFixAgent } from './health-fix.agent';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import { HealthFixOutputSchema } from './schemas/health-fix-output.schema';

describe('buildHealthFixAgent', () => {
  let mockFactory: DeepMocked<DeepAgentFactory>;

  beforeEach(() => {
    mockFactory = createMock<DeepAgentFactory>();
    mockFactory.create.mockReturnValue({
      usageLimits: { totalTokens: 1, toolCalls: 1 },
      outputSchema: HealthFixOutputSchema,
      invoke: async () => ({ actions: [], issues_resolved: 0, issues_skipped: 0, iteration: 1 }),
    });
  });

  it('Q9 RESOLVED: registers ONLY the read-only base 7 tools (no writeFile)', () => {
    buildHealthFixAgent(mockFactory, {
      systemPrompt: 'TEST',
      toolDeps: { vaultPath: '/tmp/v', memuApi: createMock() },
      usageLimits: { totalTokens: 100, toolCalls: 10 },
    });

    expect(mockFactory.create).toHaveBeenCalledTimes(1);
    const args = mockFactory.create.mock.calls[0]![0];
    expect(args.output).toBe(HealthFixOutputSchema);
    expect(args.tools).toHaveLength(7);
    const toolNames = args.tools.map((t: { name: string }) => t.name).sort();
    expect(toolNames).toEqual(['fileInfo', 'grep', 'listFiles', 'memuCategories', 'memuSearch', 'readFile', 'readFrontmatter']);
  });
});
