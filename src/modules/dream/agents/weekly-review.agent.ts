/**
 * Weekly Review agent builder (Story 13.12 / Task 7).
 *
 * Mirrors Python `dream_agent.py:1226-1301` (`_get_weekly_review_agent` +
 * `run_weekly_review`).
 *
 * Tools (9 = base 7 + 2 weekly-specific):
 *   - Base 7: readFile, grep, listFiles, fileInfo, readFrontmatter,
 *     memuSearch, memuCategories (from 13.10's `vault-tools.ts` via
 *     `buildBase7Tools` exported by 13.11's `deep-phase1.agent.ts`).
 *   - `readDailyLog(date_str)` — pre-loaded dict lookup (NOT live FS).
 *   - `readVaultIndex(folder)` — pre-loaded dict lookup (Q4 RESOLVED — TS
 *     port REGISTERS this tool, fixing Python prompt-vs-code drift).
 *
 * Output: `WeeklyReviewOutputSchema` (snake_case Zod). Flat schema, 4 fields.
 *
 * Token budget (Python `app/config.py:45-46`): 1_500_000 tokens / 300 tool
 * calls. Provided via `AppConfigService.weeklyReviewLimits` and threaded
 * here as the `usageLimits` opts argument.
 */
import { DeepAgentFactory, type DeepAgentFactoryAgent, type DeepAgentFactoryUsageLimits } from 'src/shared/agents/deep-agent.factory';
import { WeeklyReviewOutputSchema } from './schemas/weekly-review-output.schema';
import { type VaultToolDeps } from './tools/vault-tools';
import { readDailyLogPreloadedFactory, readVaultIndexPreloadedFactory } from './tools/weekly-tools';
import { buildBase7Tools } from './deep-phase1.agent';

export interface BuildWeeklyReviewAgentOptions {
  systemPrompt: string;
  toolDeps: VaultToolDeps;
  /** Pre-loaded daily logs (gather_dailys result) — date_str → body. */
  dailyLogs: Record<string, string>;
  /** Pre-loaded vault indexes (gather_indexes result) — folder → _index.md body. */
  vaultIndexes: Record<string, string>;
  usageLimits: DeepAgentFactoryUsageLimits;
}

export function buildWeeklyReviewAgent(
  factory: DeepAgentFactory,
  options: BuildWeeklyReviewAgentOptions,
): DeepAgentFactoryAgent<typeof WeeklyReviewOutputSchema> {
  const tools = [
    ...buildBase7Tools(options.toolDeps),
    readDailyLogPreloadedFactory(options.dailyLogs),
    readVaultIndexPreloadedFactory(options.vaultIndexes),
  ];
  return factory.create({
    systemPrompt: options.systemPrompt,
    tools,
    output: WeeklyReviewOutputSchema,
    retries: 2,
    outputRetries: 3,
    usageLimits: options.usageLimits,
  });
}
