/**
 * Deep-dream Phase 3 (Deep Sleep / Consolidation) agent builder
 * (Story 13.11 / Task 6).
 *
 * Mirrors Python `dream_agent.py:888-973` (`_get_consolidation_agent`).
 *
 * Tools (base tools + 2 phase-specific):
 *   - Base tools.
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
import { readDailyLogLiveFactory, readVaultIndexFactory } from './deep-tools';
import { buildBaseTools } from './deep-phase1.agent';

export interface BuildPhase3AgentOptions {
  systemPrompt: string;
  toolDeps: VaultToolDeps;
  /** Vault root for live FS tools. Same as toolDeps.vaultPath. */
  vaultRoot: string;
  usageLimits: DeepAgentFactoryUsageLimits;
}

export function buildPhase3Agent(
  factory: DeepAgentFactory,
  options: BuildPhase3AgentOptions,
): DeepAgentFactoryAgent<typeof ConsolidationOutputSchema> {
  const tools = [...buildBaseTools(options.toolDeps), readDailyLogLiveFactory(options.vaultRoot), readVaultIndexFactory(options.vaultRoot)];
  return factory.create({
    systemPrompt: options.systemPrompt,
    tools,
    output: ConsolidationOutputSchema,
    retries: 2,
    outputRetries: 3,
    usageLimits: options.usageLimits,
  });
}
