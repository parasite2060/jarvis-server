/**
 * Conflict-resolution agent. The orchestrator calls `agent.invoke(runPrompt)`
 * where runPrompt presents the three file versions under labelled headings the
 * system prompt expects:
 *   BASE:
 *   <common-ancestor content>
 *   DREAM:
 *   <dream-branch additions>
 *   MAIN:
 *   <main-branch content, may include the user's manual edits>
 * Returns ConflictResolutionOutput { resolvedContent, reasoning, confident }.
 */
import { DeepAgentFactory, type DeepAgentFactoryAgent, type DeepAgentFactoryUsageLimits } from 'src/shared/agents/deep-agent.factory';
import { ConflictResolutionOutputSchema } from './conflict-resolution-output.schema';

export interface BuildConflictResolverAgentOptions {
  systemPrompt: string;
  usageLimits: DeepAgentFactoryUsageLimits;
}

export function buildConflictResolverAgent(
  factory: DeepAgentFactory,
  options: BuildConflictResolverAgentOptions,
): DeepAgentFactoryAgent<typeof ConflictResolutionOutputSchema> {
  return factory.create({
    systemPrompt: options.systemPrompt,
    tools: [],
    output: ConflictResolutionOutputSchema,
    retries: 2,
    outputRetries: 3,
    usageLimits: options.usageLimits,
  });
}
