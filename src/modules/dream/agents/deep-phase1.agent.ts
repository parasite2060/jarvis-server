/**
 * Deep-dream Phase 1 (Light Sleep) agent builder (Story 13.11 / Task 6).
 *
 * Mirrors Python `dream_agent.py:1080-1140` (`_get_phase1_agent` + run-prompt
 * helpers). Uses the existing `DeepAgentFactory.create({...})` from Story
 * 13.10's `AgentsModule@Global` — no new factory infrastructure.
 *
 * Tools (base tools only):
 *   - readFile, grep, listFiles, fileInfo, readFrontmatter
 *     (base — from vault-tools.ts).
 *
 * Output: `LightSleepOutputSchema` (snake_case Zod).
 *
 * Run prompt (built by activity caller, mirrors Python lines 1126-1140):
 *   ```
 *   Inventory, deduplicate, and score today's memories.
 *
 *   ## Current MEMORY.md
 *   {memory_md or '(empty)'}
 *
 *   ## Today's Daily Log
 *   {daily_log or '(empty)'}
 *   ```
 */
import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { DeepAgentFactory, type DeepAgentFactoryAgent, type DeepAgentFactoryUsageLimits } from 'src/shared/agents/deep-agent.factory';
import { LightSleepOutputSchema } from './light-sleep-output.schema';
import { fileInfoTool, grepTool, listFilesTool, readFileTool, readFrontmatterTool, type VaultToolDeps } from './vault-tools';

export interface BuildPhase1AgentOptions {
  systemPrompt: string;
  toolDeps: VaultToolDeps;
  usageLimits: DeepAgentFactoryUsageLimits;
}

function buildBaseTools(deps: VaultToolDeps): DynamicStructuredTool[] {
  return [
    new DynamicStructuredTool({
      name: 'readFile',
      description: 'Read a vault file. Optional offset/limit for line ranges.',
      schema: z.object({ path: z.string(), offset: z.number().int().nonnegative().nullable(), limit: z.number().int().positive().nullable() }),
      func: async (input) => readFileTool(deps, input),
    }),
    new DynamicStructuredTool({
      name: 'searchVault',
      description: 'Recursively search vault files for a regex pattern. Capped at 100 matches.',
      schema: z.object({ pattern: z.string(), path: z.string().nullable() }),
      func: async (input) => grepTool(deps, input),
    }),
    new DynamicStructuredTool({
      name: 'listFiles',
      description: 'List the contents of a vault directory.',
      schema: z.object({ path: z.string().nullable() }),
      func: async (input) => listFilesTool(deps, input),
    }),
    new DynamicStructuredTool({
      name: 'fileInfo',
      description: "Get a vault file's line count, character count, and estimated token count.",
      schema: z.object({ path: z.string() }),
      func: async (input) => fileInfoTool(deps, input),
    }),
    new DynamicStructuredTool({
      name: 'readFrontmatter',
      description: 'Extract YAML frontmatter (between --- markers) from a vault file.',
      schema: z.object({ path: z.string() }),
      func: async (input) => readFrontmatterTool(deps, input),
    }),
  ];
}

export { buildBaseTools };

export function buildPhase1Agent(factory: DeepAgentFactory, options: BuildPhase1AgentOptions): DeepAgentFactoryAgent<typeof LightSleepOutputSchema> {
  const tools = [...buildBaseTools(options.toolDeps)];
  return factory.create({
    systemPrompt: options.systemPrompt,
    tools,
    output: LightSleepOutputSchema,
    retries: 2,
    outputRetries: 3,
    usageLimits: options.usageLimits,
  });
}
