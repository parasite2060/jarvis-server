/**
 * Shared module-private helpers for deep-dream per-activity files.
 * Story 13.10.5 Q4 decomposition extracted these from the grouped
 * `deep-dream.activities.ts` source.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { safeResolveVaultPath } from 'src/shared/utils/path-validation';
import type { VaultUpdates } from '../../../agents/consolidation-output.schema';
import type { HealthReport } from '../../../agents/health-report.schema';
import type { DeepCommitAndPRInput, Phase1Input, Phase3Input } from '../../workflows/deep-dream.workflow';

export const HEALTH_FIX_MAX_ITERATIONS = 3;
export const PHASE2_DAILY_LOG_WINDOW_DAYS = 7;
export const PHASE2_VAULT_INDEX_FOLDERS = ['decisions', 'patterns', 'concepts', 'connections', 'lessons', 'projects'] as const;
export const IDEMPOTENCY_LOG_PATH = '.backups/memu_align_idempotency.log';
export const MEMORY_SECTIONS_FOR_MEMU = ['Strong Patterns', 'Decisions', 'Facts'] as const;
export const SEXTY_SECONDS_MS = 60_000;

export async function safeReadVault(vaultRoot: string, relPath: string): Promise<string | null> {
  const resolved = safeResolveVaultPath(vaultRoot, relPath);
  if (resolved === null) return null;
  try {
    return await fs.readFile(resolved, 'utf-8');
  } catch {
    return null;
  }
}

export async function safeWriteVault(vaultRoot: string, relPath: string, content: string): Promise<void> {
  const resolved = safeResolveVaultPath(vaultRoot, relPath);
  if (resolved === null) return;
  try {
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, 'utf-8');
  } catch {
    // best-effort
  }
}

/**
 * Mirrors Python `_extract_memory_entries` — only `## Strong Patterns`,
 * `## Decisions`, `## Facts` sections; one entry per `- ` bullet.
 */
export function extractMemoryEntries(memoryMd: string): Array<{ type: string; content: string }> {
  const entries: Array<{ type: string; content: string }> = [];
  let currentSection: string | null = null;
  for (const line of memoryMd.split('\n')) {
    const stripped = line.trim();
    if ((MEMORY_SECTIONS_FOR_MEMU as readonly string[]).includes(stripped.replace(/^## /, ''))) {
      currentSection = stripped.replace(/^## /, '');
      continue;
    }
    if (stripped.startsWith('## ')) {
      currentSection = null;
      continue;
    }
    if (currentSection !== null && stripped.startsWith('- ')) {
      const content = stripped.slice(2).trim();
      if (content.length > 0) {
        entries.push({ type: currentSection, content });
      }
    }
  }
  return entries;
}

export function buildPhase1RunPrompt(inp: Phase1Input): string {
  return [
    "Inventory, deduplicate, and score today's memories.",
    'Use queryMemuMemories() for MemU data.',
    '',
    '## Current MEMORY.md',
    inp.memory_md.length === 0 ? '(empty)' : inp.memory_md,
    '',
    "## Today's Daily Log",
    inp.daily_log.length === 0 ? '(empty)' : inp.daily_log,
  ].join('\n');
}

export function buildPhase2RunPrompt(phase1Text: string, vaultIndexText: string): string {
  return [
    'Analyze cross-session patterns and detect themes, connections, gaps.',
    'Use readDailyLog(date_str) to read specific daily logs.',
    '',
    '## Phase 1 Candidates',
    phase1Text.length === 0 ? 'No Phase 1 candidates.' : phase1Text,
    '',
    '## Vault Indexes',
    vaultIndexText.length === 0 ? 'No vault indexes available.' : vaultIndexText,
  ].join('\n');
}

export function buildPhase3RunPrompt(inp: Phase3Input, vaultGuide: string): string {
  const sections = [
    'Consolidate memories. Produce updated MEMORY.md, daily summary, and vault updates.',
    '',
    inp.phase1_summary,
    '',
    inp.phase2_summary,
    '',
    `## Current MEMORY.md\n${inp.memory_md.length === 0 ? '(empty)' : inp.memory_md}`,
    '',
    `## Today's Daily Log\n${inp.daily_log.length === 0 ? '(empty)' : inp.daily_log}`,
  ];
  if (vaultGuide.length > 0) {
    sections.push('');
    sections.push('## Vault Guide (file templates & structure)');
    sections.push(vaultGuide);
  }
  return sections.join('\n');
}

/**
 * Q5 RESOLVED: re-creates Python's lost `_format_phase1_for_phase2`.
 * `[i] (category) content [score=X.XX, reinforced=N] [CONTRADICTION]`
 */
export function formatPhase1ForPhase2(candidates: Array<Record<string, unknown>>, scoredJson: Array<Record<string, unknown>>): string {
  const scoreMap = new Map<string, number>();
  for (const s of scoredJson) {
    const content = typeof s['content'] === 'string' ? s['content'] : '';
    const score = typeof s['score'] === 'number' ? s['score'] : 0;
    scoreMap.set(content, score);
  }
  const lines: string[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    const content = typeof c['content'] === 'string' ? c['content'] : '';
    const category = typeof c['category'] === 'string' ? c['category'] : '';
    const reinforced = typeof c['reinforcement_count'] === 'number' ? c['reinforcement_count'] : 0;
    const score = (scoreMap.get(content) ?? 0).toFixed(2);
    const contradiction = c['contradiction_flag'] === true ? ' [CONTRADICTION]' : '';
    lines.push(`[${i + 1}] (${category}) ${content} [score=${score}, reinforced=${reinforced}]${contradiction}`);
  }
  return lines.join('\n');
}

/**
 * Q5 RESOLVED: re-creates Python's lost `_format_vault_indexes`.
 * `### {folder}/\n{contents}\n\n` per folder.
 */
export function formatVaultIndexes(vaultIndexes: Record<string, string>): string {
  const lines: string[] = [];
  for (const folder of Object.keys(vaultIndexes)) {
    lines.push(`### ${folder}/`);
    lines.push(vaultIndexes[folder] ?? '');
    lines.push('');
  }
  return lines.join('\n');
}

export function buildVaultFileWithFrontmatter(
  folder: string,
  entry: { filename: string; title: string; summary: string; content: string; tags: string[] },
  sourceDateIso: string,
): string {
  const fm = [
    '---',
    `type: ${typeForFolder(folder)}`,
    'status: draft',
    `tags: [${entry.tags.map((t) => `"${t}"`).join(', ')}]`,
    `summary: "${entry.summary.replace(/"/g, '\\"')}"`,
    `created: ${sourceDateIso}`,
    `updated: ${sourceDateIso}`,
    `last_reviewed: ${sourceDateIso}`,
    'reinforcement_count: 0',
    'confidence: low',
    '---',
    '',
  ].join('\n');
  return `${fm}# ${entry.title}\n\n${entry.content}`;
}

function typeForFolder(folder: string): string {
  const map: Record<string, string> = {
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
  };
  return map[folder] ?? 'note';
}

export function countVaultUpdateEntries(updates: VaultUpdates): number {
  return (
    updates.decisions.length +
    updates.projects.length +
    updates.patterns.length +
    updates.templates.length +
    updates.concepts.length +
    updates.connections.length +
    updates.lessons.length +
    updates.topics.length
  );
}

export function emptyHealthReport(): HealthReport {
  return {
    orphan_notes: [],
    stale_notes: [],
    missing_frontmatter: [],
    unresolved_contradictions: [],
    memory_overflow: false,
    knowledge_gaps: [],
    missing_backlinks: [],
    unclassified_lessons: [],
    broken_wikilinks: [],
    total_issues: 0,
  };
}

export function filterLlmScope(report: HealthReport): HealthReport {
  const total = report.unresolved_contradictions.length + report.knowledge_gaps.length + report.unclassified_lessons.length;
  return {
    orphan_notes: [],
    stale_notes: [...report.stale_notes],
    missing_frontmatter: [],
    unresolved_contradictions: [...report.unresolved_contradictions],
    memory_overflow: report.memory_overflow,
    knowledge_gaps: [...report.knowledge_gaps],
    missing_backlinks: [],
    unclassified_lessons: [...report.unclassified_lessons],
    broken_wikilinks: [],
    total_issues: total,
  };
}

export function formatLlmHealthSummary(scoped: HealthReport): string {
  const lines: string[] = [];
  for (const e of scoped.unresolved_contradictions) lines.push(`- Unresolved contradiction: ${e}`);
  for (const e of scoped.knowledge_gaps) lines.push(`- Knowledge gap: ${e}`);
  for (const e of scoped.unclassified_lessons) lines.push(`- Unclassified lesson: ${e}`);
  return [
    'The health check found LLM-scope issues after your consolidation.',
    'Return one HealthFixAction per issue in the HealthFixOutput:',
    '',
    ...lines,
  ].join('\n');
}

export function buildDeepPRBody(inp: DeepCommitAndPRInput): string {
  const stats = inp.stats;
  const memProcessed = pickNumber(stats, 'total_memories_processed');
  const dups = pickNumber(stats, 'duplicates_removed');
  const contradictions = pickNumber(stats, 'contradictions_resolved');
  const filesList = inp.files_modified.map((fm) => `- \`${fm.path}\``).join('\n');
  return [
    '## Dream Deep Consolidation',
    '',
    `**Dream ID:** ${inp.dream_id}`,
    `**Date:** ${inp.target_date_iso}`,
    '',
    '### Stats',
    `- Memories processed: ${memProcessed}`,
    `- Duplicates removed: ${dups}`,
    `- Contradictions resolved: ${contradictions}`,
    '',
    '### Changed Files',
    filesList,
  ].join('\n');
}

function pickNumber(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  return typeof v === 'number' ? v : 0;
}
