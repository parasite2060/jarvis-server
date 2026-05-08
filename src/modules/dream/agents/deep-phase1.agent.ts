/**
 * Deep-dream Phase 1 (Light Sleep) agent builder (Story 13.11 / Task 6).
 *
 * Mirrors Python `dream_agent.py:1080-1140` (`_get_phase1_agent` + run-prompt
 * helpers). Uses the existing `DeepAgentFactory.create({...})` from Story
 * 13.10's `AgentsModule@Global` — no new factory infrastructure.
 *
 * Tools (8 = base 7 + 1 phase-specific):
 *   - readFile, grep, listFiles, fileInfo, readFrontmatter, memuSearch,
 *     memuCategories (base 7 — from vault-tools.ts).
 *   - queryMemuMemories — phase-specific (pre-loaded MemU snapshot).
 *
 * Output: `LightSleepOutputSchema` (snake_case Zod).
 *
 * Run prompt (built by activity caller, mirrors Python lines 1126-1140):
 *   ```
 *   Inventory, deduplicate, and score today's memories.
 *   Use queryMemuMemories() for MemU data.
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
import {
  fileInfoTool,
  grepTool,
  listFilesTool,
  memuCategoriesTool,
  memuSearchTool,
  readFileTool,
  readFrontmatterTool,
  type VaultToolDeps,
} from './vault-tools';
import { queryMemuMemoriesFactory } from './deep-tools';

export interface BuildPhase1AgentOptions {
  systemPrompt: string;
  toolDeps: VaultToolDeps;
  /** Pre-loaded MemU memories (gather_inputs result). */
  memuMemories: Array<Record<string, unknown>>;
  usageLimits: DeepAgentFactoryUsageLimits;
}

function buildBase7Tools(deps: VaultToolDeps): DynamicStructuredTool[] {
  return [
    new DynamicStructuredTool({
      name: 'readFile',
      description: 'Read a vault file. Optional offset/limit for line ranges.',
      schema: z.object({ path: z.string(), offset: z.number().int().nonnegative().optional(), limit: z.number().int().positive().optional() }),
      func: async (input) => readFileTool(deps, input),
    }),
    new DynamicStructuredTool({
      name: 'grep',
      description: 'Recursively search vault files for a regex pattern. Capped at 100 matches.',
      schema: z.object({ pattern: z.string(), path: z.string().optional() }),
      func: async (input) => grepTool(deps, input),
    }),
    new DynamicStructuredTool({
      name: 'listFiles',
      description: 'List the contents of a vault directory.',
      schema: z.object({ path: z.string().optional() }),
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
    new DynamicStructuredTool({
      name: 'memuSearch',
      description: 'Semantic search across MemU-managed knowledge.',
      schema: z.object({ query: z.string(), limit: z.number().int().positive().optional() }),
      func: async (input) => memuSearchTool(deps, input),
    }),
    new DynamicStructuredTool({
      name: 'memuCategories',
      description: 'List the available MemU memory categories.',
      schema: z.object({}),
      func: async () => memuCategoriesTool(),
    }),
  ];
}

export { buildBase7Tools };

export function buildPhase1Agent(factory: DeepAgentFactory, options: BuildPhase1AgentOptions): DeepAgentFactoryAgent<typeof LightSleepOutputSchema> {
  const tools = [...buildBase7Tools(options.toolDeps), queryMemuMemoriesFactory(options.memuMemories)];
  return factory.create({
    systemPrompt: options.systemPrompt,
    tools,
    output: LightSleepOutputSchema,
    retries: 2,
    outputRetries: 3,
    usageLimits: options.usageLimits,
  });
}
