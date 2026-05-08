/**
 * Deep-dream Phase 3 (Deep Sleep / Consolidation) agent builder
 * (Story 13.11 / Task 6).
 *
 * Mirrors Python `dream_agent.py:888-973` (`_get_consolidation_agent`).
 *
 * Tools (10 = base 7 + 3 phase-specific):
 *   - Base 7.
 *   - queryMemuMemories — pre-loaded MemU snapshot.
 *   - readDailyLog — Phase 3 variant — live FS read.
 *   - readVaultIndex — live read of `{folder}/_index.md`.
 *
 * Output: `ConsolidationOutputSchema` (snake_case Zod). Phase 3's LLM does
 * NOT populate `vault_writes` (Q3 deviation field — populated by
 * `writeFiles` activity from `vault_updates` after Q14 topics-drop).
 */
import { DeepAgentFactory, type DeepAgentFactoryAgent, type DeepAgentFactoryUsageLimits } from 'src/shared/agents/deep-agent.factory';
import { ConsolidationOutputSchema } from './consolidation-output.schema';
import { type VaultToolDeps } from './vault-tools';
import { queryMemuMemoriesFactory, readDailyLogLiveFactory, readVaultIndexFactory } from './deep-tools';
import { buildBase7Tools } from './deep-phase1.agent';

export interface BuildPhase3AgentOptions {
  systemPrompt: string;
  toolDeps: VaultToolDeps;
  memuMemories: Array<Record<string, unknown>>;
  /** Vault root for live FS tools. Same as toolDeps.vaultPath. */
  vaultRoot: string;
  usageLimits: DeepAgentFactoryUsageLimits;
}

export function buildPhase3Agent(
  factory: DeepAgentFactory,
  options: BuildPhase3AgentOptions,
): DeepAgentFactoryAgent<typeof ConsolidationOutputSchema> {
  const tools = [
    ...buildBase7Tools(options.toolDeps),
    queryMemuMemoriesFactory(options.memuMemories),
    readDailyLogLiveFactory(options.vaultRoot),
    readVaultIndexFactory(options.vaultRoot),
  ];
  return factory.create({
    systemPrompt: options.systemPrompt,
    tools,
    output: ConsolidationOutputSchema,
    retries: 2,
    outputRetries: 3,
    usageLimits: options.usageLimits,
  });
}
