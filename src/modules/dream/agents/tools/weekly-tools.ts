/**
 * Weekly-review-specific agent tools (Story 13.12 / Task 6).
 *
 * Built as factories so callers (the weekly-review agent builder) can
 * capture the relevant deps once and pass simple input handlers to
 * deepagents' `DynamicStructuredTool`.
 *
 * Tools:
 *   - `readDailyLog(date_str)` — deps-dict-backed lookup of pre-loaded
 *     `daily_logs` (matches Python `dream_agent.py:1263-1269` weekly
 *     variant). NO live FS read.
 *   - `readVaultIndex(folder)` — Q4 RESOLVED 2026-05-08: TS port REGISTERS
 *     this tool (Python prompt mentions it but agent doesn't register it).
 *     Deps-dict-backed lookup of pre-loaded `vault_indexes` from
 *     `gatherIndexes`. The vault indexes ARE already in memory — making
 *     them accessible via the tool fixes Python's prompt-vs-code drift.
 *
 * The base 7 tools (`readFile`, `grep`, `listFiles`, `fileInfo`,
 * `readFrontmatter`, `memuSearch`, `memuCategories`) are reused unchanged
 * from `vault-tools.ts` via `buildBase7Tools` exported by 13.11's
 * `deep-phase1.agent.ts`.
 */
import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';

/**
 * `readDailyLog` factory — Weekly variant (pre-loaded dict).
 *
 * Mirrors Python `dream_agent.py:1263-1269` — looks up `deps.daily_logs[date_str]`.
 * The pre-loaded dict is the 7-day window collected by `gatherDailys`. Returns
 * the body or a standard "(no daily log)" sentinel.
 *
 * Same shape as 13.11's `readDailyLogPreloadedFactory` (Phase 2 variant) — we
 * keep it weekly-local for clarity rather than cross-importing from
 * `deep-tools.ts`. Identical output sentinels keep the agent prompt ports
 * indistinguishable.
 */
export function readDailyLogPreloadedFactory(dailyLogs: Record<string, string>): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'readDailyLog',
    description: 'Return the pre-loaded daily log for `date_str` (YYYY-MM-DD). Weekly review — pre-loaded dict.',
    schema: z.object({ date_str: z.string() }),
    func: async (input) => {
      const content = dailyLogs[input.date_str];
      return content ?? '(no daily log)';
    },
  });
}

/**
 * `readVaultIndex` factory — Weekly variant (pre-loaded dict).
 *
 * Q4 RESOLVED 2026-05-08: TS port registers this tool to fix Python's
 * prompt-vs-code drift. Vault `_index.md` files are pre-loaded by
 * `gatherIndexes` and stuffed into the agent's `vault_indexes` deps. Tool
 * looks them up and returns the body, or "(no index)" sentinel.
 *
 * The deep-dream Phase 3 agent uses a LIVE FS variant
 * (`deep-tools.ts::readVaultIndexFactory`); the weekly variant mirrors the
 * `readDailyLogPreloadedFactory` deps-dict pattern since indexes are
 * already in memory by the time the agent runs.
 */
export function readVaultIndexPreloadedFactory(vaultIndexes: Record<string, string>): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'readVaultIndex',
    description: 'Read pre-loaded `{folder}/_index.md` for a vault folder. Weekly review — pre-loaded dict.',
    schema: z.object({ folder: z.string() }),
    func: async (input) => {
      const content = vaultIndexes[input.folder];
      return content ?? '(no index)';
    },
  });
}
