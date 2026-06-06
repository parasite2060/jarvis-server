import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { z } from 'zod';
import { buildConflictResolverAgent } from './conflict-resolver.agent';
import { ConflictResolutionOutputSchema } from './conflict-resolution-output.schema';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';

describe('buildConflictResolverAgent', () => {
  let mockFactory: DeepMocked<DeepAgentFactory>;

  beforeEach(() => {
    mockFactory = createMock<DeepAgentFactory>();
    mockFactory.create.mockReturnValue({
      usageLimits: { totalTokens: 1, toolCalls: 1 },
      outputSchema: ConflictResolutionOutputSchema,
      invoke: async () => ({ resolvedContent: '', reasoning: '', confident: true }),
    });
  });

  it('calls factory.create with ConflictResolutionOutputSchema, no tools, systemPrompt, and usageLimits', () => {
    buildConflictResolverAgent(mockFactory, {
      systemPrompt: 'TEST',
      usageLimits: { totalTokens: 50_000, toolCalls: 0 },
    });

    expect(mockFactory.create).toHaveBeenCalledTimes(1);
    const args = mockFactory.create.mock.calls[0]![0];
    expect(args.output).toBe(ConflictResolutionOutputSchema);
    expect(args.tools).toEqual([]);
    expect(args.systemPrompt).toBe('TEST');
    expect(args.usageLimits).toEqual({ totalTokens: 50_000, toolCalls: 0 });
  });

  it('output schema has no ZodOptional fields (Azure strict mode)', () => {
    const shape = (ConflictResolutionOutputSchema as z.ZodObject<z.ZodRawShape>).shape;
    for (const [, field] of Object.entries(shape)) {
      expect(field instanceof z.ZodOptional).toBe(false);
    }
  });
});
