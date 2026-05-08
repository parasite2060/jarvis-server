/**
 * Deep-dream-specific agent tools (Story 13.11 / Task 5).
 *
 * Built as factories so callers (the four agent builders) can capture the
 * relevant deps once and pass simple input handlers to deepagents'
 * `DynamicStructuredTool`.
 *
 * Tools:
 *   - `queryMemuMemories()` — Phase 1 / Phase 3. Formats a pre-loaded
 *     `memu_memories` list into a single string. NO live MemU call.
 *   - `readDailyLog(date_str)` — TWO impls:
 *       Phase 2 variant: pre-loaded dict lookup (`Phase2Deps.daily_logs`).
 *       Phase 3 variant: live filesystem read of `dailys/{date_str}.md`.
 *   - `readVaultIndex(folder)` — Phase 3. Live FS read of
 *     `{folder}/_index.md` rooted at `appConfig.vaultPath`.
 */
import * as fs from 'node:fs/promises';
import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { safeResolveVaultPath } from 'src/shared/utils/path-validation';

/**
 * `queryMemuMemories` factory — Phase 1 + Phase 3.
 *
 * Mirrors Python `dream_agent.py` `query_memu_memories(ctx)` — formats
 * `ctx.deps.memu_memories` (pre-loaded) into a JSON string. NO live MemU
 * call (the agent uses `memuSearch` for that). The pre-loaded list is the
 * `gather_inputs` result snapshot.
 */
export function queryMemuMemoriesFactory(memuMemories: Array<Record<string, unknown>>): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'queryMemuMemories',
    description: 'Return the pre-loaded MemU memory list captured by gather_inputs. No live MemU call.',
    schema: z.object({}),
    func: async () => JSON.stringify(memuMemories),
  });
}

/**
 * `readDailyLog` factory — Phase 2 variant (pre-loaded dict).
 *
 * Mirrors Python `phase2_rem_sleep` `read_daily_log` — looks up
 * `ctx.deps.daily_logs.get(date_str)`. The pre-loaded dict is the 7-day
 * window collected at the top of the activity. Returns the body or a
 * standard "(no daily log)" sentinel.
 */
export function readDailyLogPreloadedFactory(dailyLogs: Record<string, string>): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'readDailyLog',
    description: 'Return the pre-loaded daily log for `date_str` (YYYY-MM-DD). Phase 2 — pre-loaded dict.',
    schema: z.object({ date_str: z.string() }),
    func: async (input) => {
      const content = dailyLogs[input.date_str];
      return content ?? '(no daily log)';
    },
  });
}

/**
 * `readDailyLog` factory — Phase 3 variant (live FS read).
 *
 * Mirrors Python `dream_agent.py:946-973` Phase 3 prompt-builder + the
 * Phase 3 agent's tool registration. Reads `dailys/{date_str}.md` from
 * disk live at tool-call time, not pre-loaded.
 */
export function readDailyLogLiveFactory(vaultRoot: string): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'readDailyLog',
    description: 'Read `dailys/{date_str}.md` from disk live. Phase 3 — live FS variant.',
    schema: z.object({ date_str: z.string() }),
    func: async (input) => {
      const rel = `dailys/${input.date_str}.md`;
      const resolved = safeResolveVaultPath(vaultRoot, rel);
      if (resolved === null) return `Error: path '${rel}' is outside the vault root`;
      try {
        return await fs.readFile(resolved, 'utf-8');
      } catch {
        return '(no daily log)';
      }
    },
  });
}

/**
 * `readVaultIndex` factory — Phase 3.
 *
 * Live FS read of `{folder}/_index.md` rooted at `appConfig.vaultPath`.
 * Returns the body or "(no index)" sentinel.
 */
export function readVaultIndexFactory(vaultRoot: string): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'readVaultIndex',
    description: 'Read `{folder}/_index.md` for a vault folder. Returns body or sentinel.',
    schema: z.object({ folder: z.string() }),
    func: async (input) => {
      const rel = `${input.folder}/_index.md`;
      const resolved = safeResolveVaultPath(vaultRoot, rel);
      if (resolved === null) return `Error: path '${rel}' is outside the vault root`;
      try {
        return await fs.readFile(resolved, 'utf-8');
      } catch {
        return '(no index)';
      }
    },
  });
}
