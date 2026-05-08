import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { buildPhase1Agent } from './deep-phase1.agent';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import { LightSleepOutputSchema } from './schemas/light-sleep-output.schema';

describe('buildPhase1Agent', () => {
  let mockFactory: DeepMocked<DeepAgentFactory>;

  beforeEach(() => {
    mockFactory = createMock<DeepAgentFactory>();
    mockFactory.create.mockReturnValue({
      usageLimits: { totalTokens: 1, toolCalls: 1 },
      outputSchema: LightSleepOutputSchema,
      invoke: async () => ({ candidates: [], duplicates_removed: 0, contradictions_found: 0 }),
    });
  });

  it('calls factory.create with the LightSleepOutputSchema and 8 tools (base 7 + queryMemuMemories)', () => {
    // Arrange / Act
    buildPhase1Agent(mockFactory, {
      systemPrompt: 'TEST',
      toolDeps: { vaultPath: '/tmp/v', memuApi: createMock() },
      memuMemories: [{ content: 'mem' }],
      usageLimits: { totalTokens: 100_000, toolCalls: 50 },
    });

    // Assert
    expect(mockFactory.create).toHaveBeenCalledTimes(1);
    const args = mockFactory.create.mock.calls[0]![0];
    expect(args.output).toBe(LightSleepOutputSchema);
    expect(args.tools).toHaveLength(8);
    expect(args.systemPrompt).toBe('TEST');
    expect(args.usageLimits).toEqual({ totalTokens: 100_000, toolCalls: 50 });
  });
});
