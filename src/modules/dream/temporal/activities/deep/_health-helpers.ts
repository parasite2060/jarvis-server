/**
 * Pure deterministic deep-dream health checker + auto-fixer.
 *
 * Story 13.10.5 / Q5: moved from `src/modules/dream/health/` into the
 * deep activities subfolder per module-map §1 (no `dream/health/` allowed).
 * Both `runHealthChecks` and `autoFixHealthIssues` are used by
 * `run-health-check.activity.ts` and `run-health-fix.activity.ts`.
 *
 * Mirrors Python `services/deep_dream.py:368-595` line-for-line. NO LLM,
 * NO MemU, NO DB. Reads vault filesystem only.
 *
 * 9 issue types:
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
import type { HealthReport } from '../../../agents/health-report.schema';

const VAULT_FOLDERS = ['decisions', 'patterns', 'projects', 'templates', 'concepts', 'connections', 'lessons', 'references', 'reviews'] as const;

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
  staleDays?: number;
}

export async function runHealthChecks(vaultRoot: string, knowledgeGaps: string[] = [], options: RunHealthChecksOptions = {}): Promise<HealthReport> {
  const staleDays = options.staleDays ?? STALE_DAYS_DEFAULT;

  const orphan_notes: string[] = [];
  const stale_notes: string[] = [];
  const missing_frontmatter: string[] = [];
  const unresolved_contradictions: string[] = [];
  const unclassified_lessons: string[] = [];
  let memory_overflow = false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

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

      const stem = entry.replace(/\.md$/, '');
      if (indexContent !== null && !indexContent.includes(stem) && !indexContent.includes(entry)) {
        orphan_notes.push(relPath);
      }

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

      if (folder === 'references') continue;

      if (FRONTMATTER_HAS_CONTRADICTION_RE.test(frontmatter)) {
        unresolved_contradictions.push(relPath);
      }

      const reviewedMatch = FRONTMATTER_LAST_REVIEWED_RE.exec(frontmatter);
      if (reviewedMatch !== null) {
        const reviewed = parseIsoDate(reviewedMatch[1]!);
        if (reviewed !== null && daysBetween(reviewed, today) > staleDays) {
          stale_notes.push(relPath);
        }
      }

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

  const memoryPath = path.join(vaultRoot, 'MEMORY.md');
  const memoryContent = await safeReadText(memoryPath);
  if (memoryContent !== null) {
    const lineCount = memoryContent.split('\n').length;
    if (lineCount > MEMORY_OVERFLOW_THRESHOLD) {
      memory_overflow = true;
    }
  }

  const missing_backlinks = await detectMissingBacklinks(vaultRoot);
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

async function detectMissingBacklinks(vaultRoot: string): Promise<string[]> {
  const missing: string[] = [];
  const seen = new Set<string>();

  for (const folder of VAULT_FOLDERS) {
    const folderPath = path.join(vaultRoot, folder);
    if (!(await isDirectory(folderPath))) continue;
    if (folder === 'references') continue;

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
        if (targetFolder === 'references') continue;

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
// Auto-fixers — Q5 inlined from auto-fix-health-issues.ts
// ---------------------------------------------------------------------------

interface AutoFixCounts {
  fixed_backlinks: number;
  fixed_frontmatter: number;
  fixed_orphans: number;
}

const FRONTMATTER_FOLDER_TYPE_MAP: Record<string, string> = {
  decisions: 'decision',
  patterns: 'pattern',
  projects: 'project',
  templates: 'template',
  concepts: 'concept',
  connections: 'connection',
  lessons: 'lesson',
  references: 'reference',
  reviews: 'review',
  topics: 'topic',
  dailys: 'daily',
};

const DEFAULT_FRONTMATTER_TEMPLATE = (typeName: string, dateIso: string): string =>
  `---\ntype: ${typeName}\nstatus: draft\ntags: []\ncreated: ${dateIso}\nupdated: ${dateIso}\nlast_reviewed: ${dateIso}\nreinforcement_count: 0\nconfidence: low\n---\n`;

export interface AutoFixHealthIssuesOptions {
  todayIso?: string;
}

export async function autoFixHealthIssues(vaultRoot: string, report: HealthReport, options: AutoFixHealthIssuesOptions = {}): Promise<AutoFixCounts> {
  const todayIso = options.todayIso ?? new Date().toISOString().slice(0, 10);
  const counts: AutoFixCounts = {
    fixed_backlinks: 0,
    fixed_frontmatter: 0,
    fixed_orphans: 0,
  };

  for (const entry of report.missing_backlinks) {
    const fixed = await fixBacklink(vaultRoot, entry);
    if (fixed) counts.fixed_backlinks += 1;
  }

  for (const relPath of report.missing_frontmatter) {
    const fixed = await fixFrontmatter(vaultRoot, relPath, todayIso);
    if (fixed) counts.fixed_frontmatter += 1;
  }

  counts.fixed_orphans = await fixOrphanNotes(vaultRoot, report.orphan_notes);

  return counts;
}

async function fixBacklink(vaultRoot: string, entry: string): Promise<boolean> {
  const arrowIdx = entry.indexOf(' → ');
  if (arrowIdx === -1) return false;
  const sourceRel = entry.slice(0, arrowIdx).trim();
  const targetRel = entry
    .slice(arrowIdx + 3)
    .split(' (')[0]!
    .trim();

  if (targetRel.startsWith('references/')) return false;

  const targetPath = path.join(vaultRoot, targetRel);
  if (!(await fileExists(targetPath))) return false;

  const sourceSlug = sourceRel.replace(/\.md$/, '');
  const newLinkInner = `[[${sourceSlug}]]`;
  const newLine = `- ${newLinkInner}`;

  const content = (await safeReadText(targetPath)) ?? '';
  if (content.includes(newLinkInner)) return false;

  let rebuilt: string;
  if (content.includes('## Related')) {
    const relatedIdx = content.indexOf('## Related');
    const nextSection = content.indexOf('\n## ', relatedIdx + '## Related'.length);
    const insertPos = nextSection === -1 ? content.length : nextSection;
    const prefix = content.slice(0, insertPos).trimEnd();
    const suffix = content.slice(insertPos);
    rebuilt = `${prefix}\n${newLine}\n`;
    if (suffix.length > 0) {
      rebuilt += suffix.startsWith('\n') ? suffix : `\n${suffix}`;
    }
  } else {
    rebuilt = `${content.trimEnd()}\n\n## Related\n${newLine}\n`;
  }

  await fs.writeFile(targetPath, rebuilt, 'utf-8');
  return true;
}

async function fixFrontmatter(vaultRoot: string, relPath: string, todayIso: string): Promise<boolean> {
  const filePath = path.join(vaultRoot, relPath);
  if (!(await fileExists(filePath))) return false;
  const content = (await safeReadText(filePath)) ?? '';
  if (content.trimStart().startsWith('---')) return false;

  const folder = relPath.split('/')[0]!;
  const typeName = FRONTMATTER_FOLDER_TYPE_MAP[folder] ?? 'note';
  const fm = DEFAULT_FRONTMATTER_TEMPLATE(typeName, todayIso);
  await fs.writeFile(filePath, `${fm}\n${content}`, 'utf-8');
  return true;
}

async function fixOrphanNotes(vaultRoot: string, orphans: string[]): Promise<number> {
  let fixed = 0;
  const byFolder = new Map<string, string[]>();
  for (const rel of orphans) {
    const idx = rel.indexOf('/');
    if (idx === -1) continue;
    const folder = rel.slice(0, idx);
    const existing = byFolder.get(folder) ?? [];
    existing.push(rel);
    byFolder.set(folder, existing);
  }

  for (const [folder, folderOrphans] of byFolder) {
    const indexPath = path.join(vaultRoot, folder, '_index.md');
    if (!(await fileExists(indexPath))) {
      const folderPath = path.join(vaultRoot, folder);
      const entries = await listMdFiles(folderPath);
      const lines: string[] = [`# ${folder.charAt(0).toUpperCase() + folder.slice(1)}`, ''];
      for (const e of entries) {
        if (e === '_index.md') continue;
        const stem = e.replace(/\.md$/, '');
        const title = stem
          .split('-')
          .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
          .join(' ');
        lines.push(`- [${title}](${e})`);
      }
      await fs.writeFile(indexPath, `${lines.join('\n')}\n`, 'utf-8');
      fixed += folderOrphans.length;
      continue;
    }

    let content = (await safeReadText(indexPath)) ?? '';
    let changed = false;
    for (const relPath of folderOrphans) {
      const filename = relPath.slice(folder.length + 1);
      if (content.includes(`](${filename})`)) continue;
      const stem = filename.replace(/\.md$/, '');
      const title = stem
        .split('-')
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(' ');
      const entry = `- [${title}](${filename})`;
      content = `${content.trimEnd()}\n${entry}\n`;
      changed = true;
      fixed += 1;
    }
    if (changed) {
      await fs.writeFile(indexPath, content, 'utf-8');
    }
  }
  return fixed;
}

// ---------------------------------------------------------------------------
// FS helpers
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
