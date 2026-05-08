import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { buildPhase2Agent } from './deep-phase2.agent';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import { REMSleepOutputSchema } from './schemas/rem-sleep-output.schema';

describe('buildPhase2Agent', () => {
  let mockFactory: DeepMocked<DeepAgentFactory>;

  beforeEach(() => {
    mockFactory = createMock<DeepAgentFactory>();
    mockFactory.create.mockReturnValue({
      usageLimits: { totalTokens: 1, toolCalls: 1 },
      outputSchema: REMSleepOutputSchema,
      invoke: async () => ({ themes: [], new_connections: [], promotion_candidates: [], gaps: [] }),
    });
  });

  it('calls factory.create with REMSleepOutputSchema and 8 tools (base 7 + readDailyLog pre-loaded)', () => {
    buildPhase2Agent(mockFactory, {
      systemPrompt: 'TEST',
      toolDeps: { vaultPath: '/tmp/v', memuApi: createMock() },
      dailyLogs: { '2026-05-07': 'body' },
      usageLimits: { totalTokens: 100, toolCalls: 10 },
    });

    expect(mockFactory.create).toHaveBeenCalledTimes(1);
    const args = mockFactory.create.mock.calls[0]![0];
    expect(args.output).toBe(REMSleepOutputSchema);
    expect(args.tools).toHaveLength(8);
  });
});
