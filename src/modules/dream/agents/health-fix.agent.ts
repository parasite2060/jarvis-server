/**
 * Deep-dream Health Fix agent builder (Story 13.11 / Task 6).
 *
 * Mirrors Python `dream_agent.py` (`_get_health_fix_agent`, ~line 1032) +
 * `prompts/deep_dream_health_fix.md`.
 *
 * # Q9 RESOLVED 2026-05-08: NO `writeFile` tool registered
 *   The agent emits `HealthFixAction` records describing what *should* be
 *   done; vault writes flow through Phase 3's triple-collection (Q3). The
 *   Python prompt's `write_file` reference is a known fiction — stripped
 *   from the TS prompt port.
 *
 * Tools (7 = base 7 only):
 *   - readFile, grep, listFiles, fileInfo, readFrontmatter, memuSearch,
 *     memuCategories.
 *
 * Output: `HealthFixOutputSchema`.
 *
 * `messageHistory` continuation: the activity passes Phase 3's serialized
 * conversation via `agent.invoke(prompt, { messageHistory })`. The factory's
 * `compactHistory` middleware (Story 13.11 / Q1) compacts old tool returns
 * before invocation.
 */
import { DeepAgentFactory, type DeepAgentFactoryAgent, type DeepAgentFactoryUsageLimits } from 'src/shared/agents/deep-agent.factory';
import { HealthFixOutputSchema } from './health-fix-output.schema';
import { type VaultToolDeps } from './vault-tools';
import { buildBase7Tools } from './deep-phase1.agent';

export interface BuildHealthFixAgentOptions {
  systemPrompt: string;
  toolDeps: VaultToolDeps;
  usageLimits: DeepAgentFactoryUsageLimits;
}

export function buildHealthFixAgent(
  factory: DeepAgentFactory,
  options: BuildHealthFixAgentOptions,
): DeepAgentFactoryAgent<typeof HealthFixOutputSchema> {
  // Q9: NO writeFile registered. Read-only base 7.
  const tools = buildBase7Tools(options.toolDeps);
  return factory.create({
    systemPrompt: options.systemPrompt,
    tools,
    output: HealthFixOutputSchema,
    retries: 2,
    outputRetries: 3,
    usageLimits: options.usageLimits,
  });
}
