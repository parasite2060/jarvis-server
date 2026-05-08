import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { buildWeeklyReviewAgent } from './weekly-review.agent';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import { WeeklyReviewOutputSchema } from './weekly-review-output.schema';

describe('buildWeeklyReviewAgent', () => {
  let mockFactory: DeepMocked<DeepAgentFactory>;

  beforeEach(() => {
    mockFactory = createMock<DeepAgentFactory>();
    mockFactory.create.mockReturnValue({
      usageLimits: { totalTokens: 1, toolCalls: 1 },
      outputSchema: WeeklyReviewOutputSchema,
      invoke: async () => ({ review_content: '', week_themes: [], stale_action_items: [], project_updates: {} }),
    });
  });

  it('calls factory.create with WeeklyReviewOutputSchema and 9 tools (base 7 + readDailyLog + readVaultIndex)', () => {
    // Arrange / Act
    buildWeeklyReviewAgent(mockFactory, {
      systemPrompt: 'WEEKLY-PROMPT',
      toolDeps: { vaultPath: '/tmp/v', memuApi: createMock() },
      dailyLogs: { '2026-05-04': 'monday' },
      vaultIndexes: { decisions: 'idx' },
      usageLimits: { totalTokens: 1_500_000, toolCalls: 300 },
    });

    // Assert
    expect(mockFactory.create).toHaveBeenCalledTimes(1);
    const args = mockFactory.create.mock.calls[0]![0];
    expect(args.output).toBe(WeeklyReviewOutputSchema);
    expect(args.tools).toHaveLength(9);
    expect(args.systemPrompt).toBe('WEEKLY-PROMPT');
    expect(args.usageLimits).toEqual({ totalTokens: 1_500_000, toolCalls: 300 });
    expect(args.retries).toBe(2);
    expect(args.outputRetries).toBe(3);
  });

  it('threads readDailyLog tool with pre-loaded dict', async () => {
    // Arrange
    buildWeeklyReviewAgent(mockFactory, {
      systemPrompt: 'p',
      toolDeps: { vaultPath: '/tmp/v', memuApi: createMock() },
      dailyLogs: { '2026-05-04': 'Monday content' },
      vaultIndexes: {},
      usageLimits: { totalTokens: 1, toolCalls: 1 },
    });
    const tools = mockFactory.create.mock.calls[0]![0].tools;
    const readDailyLog = tools.find((t) => t.name === 'readDailyLog');

    // Assert + Act
    expect(readDailyLog).toBeDefined();
    const result = await readDailyLog!.invoke({ date_str: '2026-05-04' });
    expect(result).toBe('Monday content');
  });

  it('threads readVaultIndex tool with pre-loaded dict (Q4 fix)', async () => {
    // Arrange
    buildWeeklyReviewAgent(mockFactory, {
      systemPrompt: 'p',
      toolDeps: { vaultPath: '/tmp/v', memuApi: createMock() },
      dailyLogs: {},
      vaultIndexes: { decisions: '- decision' },
      usageLimits: { totalTokens: 1, toolCalls: 1 },
    });
    const tools = mockFactory.create.mock.calls[0]![0].tools;
    const readVaultIndex = tools.find((t) => t.name === 'readVaultIndex');

    // Assert + Act
    expect(readVaultIndex).toBeDefined();
    const result = await readVaultIndex!.invoke({ folder: 'decisions' });
    expect(result).toBe('- decision');
  });
});
