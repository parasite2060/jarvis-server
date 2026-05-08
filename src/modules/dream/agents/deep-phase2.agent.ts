/**
 * Deep-dream Phase 2 (REM Sleep) agent builder (Story 13.11 / Task 6).
 *
 * Mirrors Python `dream_agent.py:1167-1219` (`_get_phase2_agent`).
 *
 * Tools (8 = base 7 + 1 phase-specific):
 *   - Base 7 (from vault-tools.ts).
 *   - readDailyLog — Phase 2 variant — pre-loaded dict lookup.
 *
 * Output: `REMSleepOutputSchema` (snake_case Zod).
 *
 * Soft-fail policy: the activity wraps `agent.invoke()` in try/catch and
 * returns `{ output_json: null }` on any exception. Phase 3's prompt
 * substitutes an empty Phase 2 summary when null.
 */
import { DeepAgentFactory, type DeepAgentFactoryAgent, type DeepAgentFactoryUsageLimits } from 'src/shared/agents/deep-agent.factory';
import { REMSleepOutputSchema } from './rem-sleep-output.schema';
import { type VaultToolDeps } from './vault-tools';
import { readDailyLogPreloadedFactory } from './deep-tools';
import { buildBase7Tools } from './deep-phase1.agent';

export interface BuildPhase2AgentOptions {
  systemPrompt: string;
  toolDeps: VaultToolDeps;
  /** Pre-loaded daily logs keyed by ISO date (7-day window). */
  dailyLogs: Record<string, string>;
  usageLimits: DeepAgentFactoryUsageLimits;
}

export function buildPhase2Agent(factory: DeepAgentFactory, options: BuildPhase2AgentOptions): DeepAgentFactoryAgent<typeof REMSleepOutputSchema> {
  const tools = [...buildBase7Tools(options.toolDeps), readDailyLogPreloadedFactory(options.dailyLogs)];
  return factory.create({
    systemPrompt: options.systemPrompt,
    tools,
    output: REMSleepOutputSchema,
    retries: 2,
    outputRetries: 3,
    usageLimits: options.usageLimits,
  });
}
