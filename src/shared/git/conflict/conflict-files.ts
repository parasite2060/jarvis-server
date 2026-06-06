import type { SimpleGit } from 'simple-git';

export interface ConflictVersions {
  base: string; // :1 — common ancestor ('' if add/add, no base)
  dream: string; // :3 — the dream branch's changes (the commit being applied)
  main: string; // :2 — origin/main's content (the user's manual edits)
}

/**
 * Reads the three index stages of a conflicted file during a rebase, labeled
 * here by meaning, not by git's ours/theirs: during rebase, stage :2 is
 * origin/main and stage :3 is the rebased (dream) commit. A missing stage
 * (e.g. add/add has no base) yields ''.
 */
export async function readConflictVersions(git: SimpleGit, filePath: string): Promise<ConflictVersions> {
  const base = await showStage(git, 1, filePath);
  const dream = await showStage(git, 3, filePath);
  const main = await showStage(git, 2, filePath);
  return { base, dream, main };
}

async function showStage(git: SimpleGit, stage: 1 | 2 | 3, filePath: string): Promise<string> {
  try {
    return await git.raw(['show', `:${stage}:${filePath}`]);
  } catch {
    return '';
  }
}

export function isProtected(filePath: string, protectedFiles: string[]): boolean {
  return protectedFiles.includes(filePath);
}

export function matchesAllowGlobs(filePath: string, globs: string[]): boolean {
  return globs.some((g) => {
    if (g.endsWith('/*')) {
      const prefix = g.slice(0, -2);
      return filePath.startsWith(prefix + '/');
    }
    return filePath === g;
  });
}
