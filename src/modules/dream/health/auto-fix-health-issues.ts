/**
 * Deterministic auto-fixers for deep-dream health issues (Story 13.11 / Task 8).
 *
 * Mirrors Python `services/deep_dream.py::auto_fix_health_issues` plus
 * Stories 11.11/11.12/11.13 idempotent backlink/frontmatter/orphan fixers.
 * NO LLM. Each pass is byte-equal idempotent: running twice on the same
 * input is a no-op for already-fixed files.
 *
 * Auto-fix scope (per Dev Notes §G):
 *   - missing_backlinks  → write reverse `[[...]]` link in target's `## Related`
 *   - missing_frontmatter → prepend default frontmatter (Story 11.11)
 *   - orphan_notes       → bootstrap or append to `_index.md` (Story 11.12)
 *
 * Out-of-scope (LLM owns OR detection-only):
 *   - unresolved_contradictions, knowledge_gaps, unclassified_lessons → Health Fix LLM
 *   - stale_notes, memory_overflow, broken_wikilinks → detection-only
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { HealthReport } from '../agents/schemas/health-report.schema';

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
  /** ISO YYYY-MM-DD; injected by activity for replay-safe today-string. */
  todayIso?: string;
}

/**
 * Apply Python-side auto-fixers. Returns counts for telemetry. Errors on
 * individual files are swallowed (logged at the activity level — this
 * helper has no logger to keep it pure).
 */
export async function autoFixHealthIssues(vaultRoot: string, report: HealthReport, options: AutoFixHealthIssuesOptions = {}): Promise<AutoFixCounts> {
  const todayIso = options.todayIso ?? new Date().toISOString().slice(0, 10);
  const counts: AutoFixCounts = {
    fixed_backlinks: 0,
    fixed_frontmatter: 0,
    fixed_orphans: 0,
  };

  // 1. missing_backlinks
  for (const entry of report.missing_backlinks) {
    const fixed = await fixBacklink(vaultRoot, entry);
    if (fixed) counts.fixed_backlinks += 1;
  }

  // 2. missing_frontmatter (idempotent — skip if file already starts with `---`)
  for (const relPath of report.missing_frontmatter) {
    const fixed = await fixFrontmatter(vaultRoot, relPath, todayIso);
    if (fixed) counts.fixed_frontmatter += 1;
  }

  // 3. orphan_notes — append to or bootstrap _index.md
  counts.fixed_orphans = await fixOrphanNotes(vaultRoot, report.orphan_notes);

  return counts;
}

async function fixBacklink(vaultRoot: string, entry: string): Promise<boolean> {
  // Format: `source/path.md → target/path.md (no reverse link)`
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
  if (content.includes(newLinkInner)) return false; // idempotent

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
  if (content.trimStart().startsWith('---')) return false; // idempotent

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
      // Bootstrap: build a fresh index. Simplest correct behaviour: list
      // every *.md in the folder (which includes the orphans).
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
      if (content.includes(`](${filename})`)) continue; // idempotent
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
