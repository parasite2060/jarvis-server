/**
 * Pure deterministic deep-dream health checker (Story 13.11 / Task 8).
 *
 * Mirrors Python `services/deep_dream.py:368-595` line-for-line. NO LLM,
 * NO MemU, NO DB. Reads vault filesystem only. Returns a `HealthReport`
 * dict whose shape is defined by `health-report.schema.ts`.
 *
 * 9 issue types (Python implements 9; the design doc says "8" — code wins
 * per the standing Epic-13 rule). `broken_wikilinks` was added in Story
 * 11.13. Per Dev Notes §G:
 *
 *   1. orphan_notes              — `*.md` not in folder's `_index.md`
 *   2. stale_notes               — `last_reviewed` > 60 days (refs/ skipped)
 *   3. missing_frontmatter       — file doesn't start with `---` or no closing fence
 *   4. unresolved_contradictions — `has_contradiction: true` regex (refs/ skipped)
 *   5. memory_overflow           — MEMORY.md line count > 180
 *   6. knowledge_gaps            — pass-through from Phase 2
 *   7. missing_backlinks         — `[[folder/file]]` link without reverse (refs/ excluded)
 *   8. unclassified_lessons      — lessons/ files older than 90 days with no `outcome:`
 *   9. broken_wikilinks          — `[[target]]` where `vault/{target}.md` missing
 *
 * `total_issues` formula: sum of all 8 list lengths PLUS `1 if memory_overflow else 0`.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { HealthReport } from '../agents/schemas/health-report.schema';

/** Folders scanned for vault-folder issues 1-4, 7, 8. */
const VAULT_FOLDERS = ['decisions', 'patterns', 'projects', 'templates', 'concepts', 'connections', 'lessons', 'references', 'reviews'] as const;

/** Folders excluded from `broken_wikilinks` walk per Python `WIKILINK_SCAN_EXCLUDES`. */
const WIKILINK_SCAN_EXCLUDES = new Set(['.backups', 'transcripts', 'dailys']);

const STALE_DAYS_DEFAULT = 60;
const UNCLASSIFIED_LESSON_DAYS = 90;
export const MEMORY_OVERFLOW_THRESHOLD = 180;

const FRONTMATTER_HAS_CONTRADICTION_RE = /has_contradiction:\s*true/i;
const FRONTMATTER_LAST_REVIEWED_RE = /last_reviewed:\s*(\d{4}-\d{2}-\d{2})/;
const FRONTMATTER_CREATED_RE = /created:\s*(\d{4}-\d{2}-\d{2})/;
const FRONTMATTER_OUTCOME_RE = /outcome:\s*\w+/;
const WIKILINK_RE = /\[\[([^\]\n]+)\]\]/g;

export interface RunHealthChecksOptions {
  /** Override stale-days threshold (defaults to 60). */
  staleDays?: number;
}

/**
 * Walk the vault and produce a HealthReport. `vaultRoot` must be an
 * absolute path; `knowledgeGaps` is the pass-through array from Phase 2.
 *
 * Today's date is read from `Date` here — the activity caller injects a
 * pre-computed `today` ISO string when determinism matters (e.g., from
 * inside Temporal activities). For the standalone TS call site this is
 * just `new Date()`.
 */
export async function runHealthChecks(vaultRoot: string, knowledgeGaps: string[] = [], options: RunHealthChecksOptions = {}): Promise<HealthReport> {
  const staleDays = options.staleDays ?? STALE_DAYS_DEFAULT;

  const orphan_notes: string[] = [];
  const stale_notes: string[] = [];
  const missing_frontmatter: string[] = [];
  const unresolved_contradictions: string[] = [];
  const unclassified_lessons: string[] = [];
  let memory_overflow = false;

  const today = new Date();
  // Strip time so date-diff math reflects whole days.
  today.setHours(0, 0, 0, 0);

  // ---- Per-folder scan (issues 1-4, 8) ----
  for (const folder of VAULT_FOLDERS) {
    const folderPath = path.join(vaultRoot, folder);
    if (!(await isDirectory(folderPath))) continue;

    const indexPath = path.join(folderPath, '_index.md');
    const indexContent = await safeReadText(indexPath);

    const entries = await listMdFiles(folderPath);
    for (const entry of entries) {
      if (entry === '_index.md') continue;
      const relPath = `${folder}/${entry}`;
      const filePath = path.join(folderPath, entry);
      const text = await safeReadText(filePath);
      if (text === null) continue;

      // 1. Orphan check: stem (or basename) not in _index.md.
      const stem = entry.replace(/\.md$/, '');
      if (indexContent !== null && !indexContent.includes(stem) && !indexContent.includes(entry)) {
        orphan_notes.push(relPath);
      }

      // 3. Frontmatter check: starts with `---` AND has closing `---`.
      if (!text.startsWith('---')) {
        missing_frontmatter.push(relPath);
        continue;
      }
      const fmEnd = text.indexOf('---', 3);
      if (fmEnd === -1) {
        missing_frontmatter.push(relPath);
        continue;
      }
      const frontmatter = text.slice(3, fmEnd);

      // references/ files are terminal — skip stale + contradiction checks.
      if (folder === 'references') continue;

      // 4. Contradiction check.
      if (FRONTMATTER_HAS_CONTRADICTION_RE.test(frontmatter)) {
        unresolved_contradictions.push(relPath);
      }

      // 2. Stale check.
      const reviewedMatch = FRONTMATTER_LAST_REVIEWED_RE.exec(frontmatter);
      if (reviewedMatch !== null) {
        const reviewed = parseIsoDate(reviewedMatch[1]!);
        if (reviewed !== null && daysBetween(reviewed, today) > staleDays) {
          stale_notes.push(relPath);
        }
      }

      // 8. Unclassified lessons (only `lessons/` folder).
      if (folder === 'lessons') {
        const createdMatch = FRONTMATTER_CREATED_RE.exec(frontmatter);
        const hasOutcome = FRONTMATTER_OUTCOME_RE.test(frontmatter);
        if (createdMatch !== null && !hasOutcome) {
          const created = parseIsoDate(createdMatch[1]!);
          if (created !== null && daysBetween(created, today) > UNCLASSIFIED_LESSON_DAYS) {
            unclassified_lessons.push(relPath);
          }
        }
      }
    }
  }

  // ---- 5. MEMORY.md overflow check ----
  const memoryPath = path.join(vaultRoot, 'MEMORY.md');
  const memoryContent = await safeReadText(memoryPath);
  if (memoryContent !== null) {
    const lineCount = memoryContent.split('\n').length;
    if (lineCount > MEMORY_OVERFLOW_THRESHOLD) {
      memory_overflow = true;
    }
  }

  // ---- 7. Missing backlinks ----
  const missing_backlinks = await detectMissingBacklinks(vaultRoot);

  // ---- 9. Broken wikilinks (Story 11.13) ----
  const broken_wikilinks = await findBrokenWikilinks(vaultRoot);

  const total_issues =
    orphan_notes.length +
    stale_notes.length +
    missing_frontmatter.length +
    unresolved_contradictions.length +
    (memory_overflow ? 1 : 0) +
    knowledgeGaps.length +
    missing_backlinks.length +
    unclassified_lessons.length +
    broken_wikilinks.length;

  return {
    orphan_notes,
    stale_notes,
    missing_frontmatter,
    unresolved_contradictions,
    memory_overflow,
    knowledge_gaps: knowledgeGaps,
    missing_backlinks,
    unclassified_lessons,
    broken_wikilinks,
    total_issues,
  };
}

// ---------------------------------------------------------------------------
// Issue 7 helper — missing backlinks
// ---------------------------------------------------------------------------

async function detectMissingBacklinks(vaultRoot: string): Promise<string[]> {
  const missing: string[] = [];
  const seen = new Set<string>();

  for (const folder of VAULT_FOLDERS) {
    const folderPath = path.join(vaultRoot, folder);
    if (!(await isDirectory(folderPath))) continue;
    if (folder === 'references') continue; // refs/ never write outbound links

    const entries = await listMdFiles(folderPath);
    for (const entry of entries) {
      if (entry === '_index.md') continue;
      const sourceRel = `${folder}/${entry}`;
      const sourceSlug = `${folder}/${entry.replace(/\.md$/, '')}`;
      const text = (await safeReadText(path.join(folderPath, entry))) ?? '';

      WIKILINK_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = WIKILINK_RE.exec(text)) !== null) {
        const linkClean = match[1]!.split('|')[0]!.trim();
        const parts = linkClean.split('/');
        if (parts.length !== 2) continue;
        const targetFolder = parts[0]!;
        if (!(VAULT_FOLDERS as readonly string[]).includes(targetFolder)) continue;
        if (targetFolder === 'references') continue; // terminal: no reverse link expected

        let targetName = parts[1]!;
        if (!targetName.endsWith('.md')) targetName = `${targetName}.md`;
        const targetPath = path.join(vaultRoot, targetFolder, targetName);
        if (!(await fileExists(targetPath))) continue;

        const targetContent = (await safeReadText(targetPath)) ?? '';
        if (targetContent.includes(`[[${sourceSlug}]]`)) continue;
        const targetRel = `${targetFolder}/${targetName}`;
        const entryStr = `${sourceRel} → ${targetRel} (no reverse link)`;
        if (seen.has(entryStr)) continue;
        seen.add(entryStr);
        missing.push(entryStr);
      }
    }
  }

  return missing;
}

// ---------------------------------------------------------------------------
// Issue 9 helper — broken wikilinks
// ---------------------------------------------------------------------------

async function findBrokenWikilinks(vaultRoot: string): Promise<string[]> {
  const unresolved: string[] = [];
  if (!(await isDirectory(vaultRoot))) return unresolved;

  await walkMd(vaultRoot, vaultRoot, async (relPath, text) => {
    const parts = relPath.split('/');
    if (parts.length > 0 && WIKILINK_SCAN_EXCLUDES.has(parts[0]!)) return;

    const seenInFile = new Set<string>();
    WIKILINK_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WIKILINK_RE.exec(text)) !== null) {
      const raw = match[1]!.split('|')[0]!.trim();
      if (seenInFile.has(raw)) continue;
      seenInFile.add(raw);
      if (raw === '' || raw.endsWith('/') || !raw.includes('/')) {
        unresolved.push(`${relPath} → [[${raw}]] (unresolved)`);
        continue;
      }
      const targetName = raw.endsWith('.md') ? raw : `${raw}.md`;
      const targetPath = path.join(vaultRoot, targetName);
      if (!(await fileExists(targetPath))) {
        unresolved.push(`${relPath} → [[${raw}]] (unresolved)`);
      }
    }
  });

  return unresolved;
}

// ---------------------------------------------------------------------------
// FS helpers (small, defensive — never throw to caller)
// ---------------------------------------------------------------------------

async function isDirectory(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function listMdFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((e) => e.endsWith('.md')).sort();
  } catch {
    return [];
  }
}

async function safeReadText(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf-8');
  } catch {
    return null;
  }
}

function parseIsoDate(s: string): Date | null {
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function daysBetween(earlier: Date, later: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / (1000 * 60 * 60 * 24));
}

async function walkMd(root: string, vaultRoot: string, visit: (relPath: string, text: string) => Promise<void>): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith('.') && root === vaultRoot) {
      // top-level dotdirs (e.g., .git, .backups) — skip the whole tree.
      continue;
    }
    const full = path.join(root, entry);
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      await walkMd(full, vaultRoot, visit);
      continue;
    }
    if (!entry.endsWith('.md')) continue;
    const text = await safeReadText(full);
    if (text === null) continue;
    const rel = path.relative(vaultRoot, full).split(path.sep).join('/');
    await visit(rel, text);
  }
}
