/**
 * Shared module-private helpers for weekly-review per-activity files.
 * Story 13.10.5 Q4 decomposition extracted these from the grouped
 * `weekly-review.activities.ts` source.
 */
import * as fs from 'node:fs/promises';
import { safeResolveVaultPath } from 'src/shared/utils/path-validation';
import type { WeeklyCommitAndPRInput } from '../../workflows/weekly-review.workflow';

export async function safeReadVault(vaultRoot: string, relPath: string): Promise<string | null> {
  const resolved = safeResolveVaultPath(vaultRoot, relPath);
  if (resolved === null) return null;
  try {
    return await fs.readFile(resolved, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Mirrors Python `write_review_file.py:21-29` byte-for-byte. The trailing
 * newline after `---` matches Python's f-string output exactly (the
 * `review_content` body is appended directly after).
 */
export function buildReviewFrontmatter(weekStartIso: string, weekIso: string): string {
  return ['---', 'type: review', 'tags: [review, weekly]', `created: ${weekStartIso}`, `week: ${weekIso}`, '---', ''].join('\n');
}

/**
 * Mirrors Python `commit_and_pr.py:67-73` byte-for-byte:
 *   ## Weekly Review
 *
 *   **Dream ID:** {dream_id}
 *   **Week:** {week_iso}
 *
 *   ### Changed Files
 *   - `path`
 */
export function buildWeeklyReviewPRBody(inp: WeeklyCommitAndPRInput): string {
  const fileLines = inp.files_modified.map((fm) => `- \`${fm.path}\``).join('\n');
  return ['## Weekly Review', '', `**Dream ID:** ${inp.dream_id}`, `**Week:** ${inp.week_iso}`, '', '### Changed Files', fileLines].join('\n');
}

// Vault folder list used by gather_indexes (mirrors Python
// `gather_indexes.py:8-15`). Frozen 6 folders; templates is excluded
// deliberately (matches Python).
export const VAULT_INDEX_FOLDERS = ['decisions', 'patterns', 'concepts', 'connections', 'lessons', 'projects'] as const;

// 7-day rolling window from `week_start` Monday (mirrors Python
// `gather_dailys.py:34` `range(7)`).
export const DAILY_LOG_WINDOW_DAYS = 7;

// 60s defensive dedup window (mirrors 13.10 Q4 / 13.11 Q4 pattern).
export const SIXTY_SECONDS_MS = 60_000;
