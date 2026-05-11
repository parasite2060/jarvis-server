/**
 * Shared module-private helpers for light-dream per-activity files.
 * Story 13.10.5 Q4 decomposition extracted these from the grouped
 * `light-dream.activities.ts` source.
 */
import {
  fileInfoTool,
  grepTool,
  listFilesTool,
  memuCategoriesTool,
  memuSearchTool,
  readFileTool,
  readFrontmatterTool,
  type VaultToolDeps,
} from '../../../agents/vault-tools';
import type { ExtractionToolFactories } from '../../../agents/light-extraction.agent';
import type { RecordToolFactories } from '../../../agents/light-record.agent';
import type { SessionLogEntry } from '../../../agents/extraction-summary.schema';
import type { CommitAndPRInput, ExtractionInput, RecordInput } from '../../workflows/light-dream.workflow';

/**
 * Mirrors Python `_count_user_messages` (`dream_agent.py:487-514`). Counts
 * lines matching `^\s*(\[[^\]]+\]\s*)?User:` — optional ISO timestamp prefix.
 */
export function countUserMessages(parsedText: string): number {
  const matches = parsedText.match(/^\s*(\[[^\]]+\]\s*)?User:/gm);
  return matches?.length ?? 0;
}

export const SHORT_SESSION_THRESHOLD = 3;

export function buildExtractionToolFactories(deps: VaultToolDeps): ExtractionToolFactories {
  return {
    readFile: (input) => readFileTool(deps, input),
    searchVault: (input) => grepTool(deps, input),
    listFiles: (input) => listFilesTool(deps, input),
    fileInfo: (input) => fileInfoTool(deps, input),
    readFrontmatter: (input) => readFrontmatterTool(deps, input),
    memuSearch: (input) => memuSearchTool(deps, input),
    memuCategories: () => memuCategoriesTool(),
  };
}

export function buildRecordToolFactories(deps: VaultToolDeps): RecordToolFactories {
  return buildExtractionToolFactories(deps);
}

export function buildExtractionRunPrompt(inp: ExtractionInput, userMessageCount: number): string {
  return [
    'Extract session insights from the transcript.',
    'Use store* tools for structured session log.',
    'Use storeSessionMemory() only for general patterns, preferences, facts, corrections.',
    '',
    '## Session Metadata',
    `Session ID: ${inp.session_id}`,
    `Project: ${inp.project ?? 'unknown'}`,
    `Token count: ${inp.token_count ?? 'unknown'}`,
    `Transcript lines: ${userMessageCount} user messages`,
    `Transcript file: ${inp.transcript_file ?? '(injected directly)'}`,
    '',
    '## Current MEMORY.md (what the vault already knows)',
    '(empty)',
    '',
    'Skip extracting insights that are already in Strong Patterns above.',
    'Focus on NEW decisions, lessons, and concepts not yet captured.',
  ].join('\n');
}

export function buildRecordRunPrompt(inp: RecordInput): string {
  const lines: string[] = [
    'Record the session to the daily log and track reinforcement signals.',
    '',
    `Session ID: ${inp.session_id}`,
    `Session start time: ${inp.session_start_iso || 'unknown'}`,
    '',
  ];
  if (inp.is_continuation) {
    lines.push(
      '## CONTINUATION MODE',
      'This is a CONTINUATION of an existing session (user closed and resumed).',
      `Find the session block with \`<!-- session_id: ${inp.session_id} -->\` in the daily log.`,
      'APPEND new information to that existing block — do NOT create a new ### Session heading.',
      `Add a \`**Continued at [HH:MM]**:\` marker before new content in each section.`,
      `Substitute the \`Session start time:\` value above for \`[HH:MM]\` (use \`00:00\` if the value is \`unknown\`).`,
      '',
    );
  }
  lines.push('## Session Log');
  lines.push(formatSessionLog(inp.session_log_json, inp.summary));
  lines.push(
    '',
    'Write the session block to dailys/. Use readFrontmatter(path) for reinforcement checks.',
    'Use memuSearch(query) to find matching vault files for reinforcement.',
  );
  return lines.join('\n');
}

export function formatSessionLog(log: SessionLogEntry, summary: string): string {
  return JSON.stringify({ summary, ...log }, null, 2);
}

export function buildPRBody(inp: CommitAndPRInput): string {
  const filesList = inp.files_modified.map((p) => `- \`${p}\``).join('\n');
  return [
    '## Dream Light Extract',
    '',
    `**Dream ID:** ${inp.dream_id}`,
    `**Session:** ${inp.session_id}`,
    `**Date:** ${inp.source_date_iso}`,
    '',
    '### Summary',
    inp.extraction_summary.slice(0, 200),
    '',
    '### Changed Files',
    filesList,
    '',
    `**Files modified:** ${inp.files_modified.length}`,
  ].join('\n');
}
