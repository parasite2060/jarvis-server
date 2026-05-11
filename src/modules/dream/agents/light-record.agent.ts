/**
 * Light-record agent builder (Story 13.10 / Task 7).
 *
 * # Q12 = (c) RECOMMENDED — RESOLVED 2026-05-08
 *   The `writeFile` tool DOES NOT write to disk during agent execution.
 *   Instead, it collects `(path, content, action)` triples into
 *   `deps.recordOutput.session_log_writes`. The `commitAndPr` activity then
 *   writes them on the new branch via `gitOps.writeFiles(...)`. This
 *   deviates from Python's behaviour (which writes during agent execution
 *   and then has Python's `git checkout -B` reset the working tree — a
 *   fragility bug). Observable behaviour identical; internal mechanism
 *   cleaner. Documented prominently in Dev Notes.
 *
 * # Glob restriction (FR45)
 *   `writeFile` glob-checks paths against `allowedPatterns: ['dailys/*.md']`
 *   via `minimatch`. Out-of-glob paths return an error string (not an
 *   exception, per Python `dream_agent.py:663-672`). `updateReinforcement`
 *   and `flagContradiction` are EXEMPT — they read existing files and
 *   append `action: 'update'` triples; commitAndPr distinguishes by action.
 */
import * as path from 'node:path';
import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import * as mm from 'micromatch';
import { DeepAgentFactory, type DeepAgentFactoryAgent, type DeepAgentFactoryUsageLimits } from 'src/shared/agents/deep-agent.factory';
import { RecordResultSchema } from './record-result.schema';
import type { RecordWriteTriple } from '../temporal/workflows/light-dream.workflow';

export interface RecordDeps {
  session_id: string;
  recordOutput: {
    session_log_writes: RecordWriteTriple[];
  };
  /** Set inside the activity body before run; used by `updateReinforcement` for `last_reinforced`. */
  today_iso: string;
}

export interface RecordToolFactories {
  /** Reads a vault file (full content). Used by updateReinforcement / flagContradiction for frontmatter mutation. */
  readFile: (input: { path: string; offset?: number; limit?: number }) => Promise<string>;
  searchVault: (input: { pattern: string; path?: string }) => Promise<string>;
  listFiles: (input: { path?: string }) => Promise<string>;
  fileInfo: (input: { path: string }) => Promise<string>;
  readFrontmatter: (input: { path: string }) => Promise<string>;
  memuSearch: (input: { query: string; limit?: number }) => Promise<string>;
  memuCategories: () => Promise<string>;
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

/**
 * Build the writeFile tool with closure-captured allowedPatterns. Mirrors
 * Python `dream_agent.py:663-672` — `fnmatch(os.path.normpath(path), pattern)`
 * → `minimatch(normalized, pattern)`.
 */
function buildWriteFileTool(deps: RecordDeps, allowedPatterns: string[]): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'writeFile',
    description: `Write a file in the vault. Allowed patterns: ${JSON.stringify(allowedPatterns)}`,
    schema: z.object({ path: z.string(), content: z.string() }),
    func: async (input) => {
      const normalized = path.posix.normalize(input.path);
      const allowed = allowedPatterns.some((pattern) => mm.isMatch(normalized, pattern));
      if (!allowed) {
        return `Error: path '${input.path}' not allowed. Allowed patterns: ${JSON.stringify(allowedPatterns)}`;
      }
      deps.recordOutput.session_log_writes.push({
        path: normalized,
        content: input.content,
        action: 'create',
      });
      return `Queued write of ${normalized} (${input.content.length} bytes)`;
    },
  });
}

function buildUpdateReinforcementTool(deps: RecordDeps, factories: RecordToolFactories): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'updateReinforcement',
    description: "Increment the reinforcement_count and set last_reinforced in a vault file's YAML frontmatter.",
    schema: z.object({ filePath: z.string() }),
    func: async (input) => {
      let raw: string;
      try {
        raw = await factories.readFile({ path: input.filePath });
      } catch (err) {
        return `Error: failed to read '${input.filePath}': ${(err as Error).message}`;
      }
      const match = FRONTMATTER_REGEX.exec(raw);
      if (match === null) {
        return `Error: '${input.filePath}' has no YAML frontmatter`;
      }
      const fmBody = match[1] ?? '';
      const body = match[2] ?? '';
      // Increment reinforcement_count — naive line-based mutation (mirrors Python regex pattern).
      let newFm = fmBody;
      let foundCount = false;
      newFm = newFm.replace(/^reinforcement_count:\s*(\d+)\s*$/m, (_full, n) => {
        foundCount = true;
        return `reinforcement_count: ${Number(n) + 1}`;
      });
      if (!foundCount) {
        newFm = `${newFm.trimEnd()}\nreinforcement_count: 1`;
      }
      let foundReinforced = false;
      newFm = newFm.replace(/^last_reinforced:\s*\S.*$/m, () => {
        foundReinforced = true;
        return `last_reinforced: ${deps.today_iso}`;
      });
      if (!foundReinforced) {
        newFm = `${newFm.trimEnd()}\nlast_reinforced: ${deps.today_iso}`;
      }
      const rewritten = `---\n${newFm}\n---\n${body}`;
      deps.recordOutput.session_log_writes.push({
        path: input.filePath,
        content: rewritten,
        action: 'update',
      });
      return `Queued reinforcement update for ${input.filePath}`;
    },
  });
}

function buildFlagContradictionTool(deps: RecordDeps, factories: RecordToolFactories): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'flagContradiction',
    description: 'Flag a contradiction on an existing vault file by setting has_contradiction + contradiction_reason.',
    schema: z.object({ filePath: z.string(), reason: z.string() }),
    func: async (input) => {
      let raw: string;
      try {
        raw = await factories.readFile({ path: input.filePath });
      } catch (err) {
        return `Error: failed to read '${input.filePath}': ${(err as Error).message}`;
      }
      const match = FRONTMATTER_REGEX.exec(raw);
      if (match === null) {
        return `Error: '${input.filePath}' has no YAML frontmatter`;
      }
      const fmBody = match[1] ?? '';
      const body = match[2] ?? '';
      let newFm = fmBody.replace(/^has_contradiction:\s*\S.*$/m, 'has_contradiction: true');
      if (!/^has_contradiction:/m.test(newFm)) {
        newFm = `${newFm.trimEnd()}\nhas_contradiction: true`;
      }
      newFm = newFm.replace(/^contradiction_reason:\s*\S.*$/m, `contradiction_reason: ${input.reason}`);
      if (!/^contradiction_reason:/m.test(newFm)) {
        newFm = `${newFm.trimEnd()}\ncontradiction_reason: ${input.reason}`;
      }
      const rewritten = `---\n${newFm}\n---\n${body}`;
      deps.recordOutput.session_log_writes.push({
        path: input.filePath,
        content: rewritten,
        action: 'update',
      });
      return `Flagged contradiction on ${input.filePath}: ${input.reason.slice(0, 60)}`;
    },
  });
}

function buildBaseTools(factories: RecordToolFactories): DynamicStructuredTool[] {
  const tools: DynamicStructuredTool[] = [];
  tools.push(
    new DynamicStructuredTool({
      name: 'readFile',
      description: 'Read a vault file.',
      schema: z.object({ path: z.string(), offset: z.number().int().nonnegative().optional(), limit: z.number().int().positive().optional() }),
      func: async (input) => factories.readFile(input),
    }),
  );
  tools.push(
    new DynamicStructuredTool({
      name: 'readFrontmatter',
      description: 'Read YAML frontmatter only.',
      schema: z.object({ path: z.string() }),
      func: async (input) => factories.readFrontmatter(input),
    }),
  );
  tools.push(
    new DynamicStructuredTool({
      name: 'searchVault',
      description: 'Recursively search vault files.',
      schema: z.object({ pattern: z.string(), path: z.string().optional() }),
      func: async (input) => factories.searchVault(input),
    }),
  );
  tools.push(
    new DynamicStructuredTool({
      name: 'listFiles',
      description: 'List vault directory contents.',
      schema: z.object({ path: z.string().optional() }),
      func: async (input) => factories.listFiles(input),
    }),
  );
  tools.push(
    new DynamicStructuredTool({
      name: 'fileInfo',
      description: 'File statistics.',
      schema: z.object({ path: z.string() }),
      func: async (input) => factories.fileInfo(input),
    }),
  );
  tools.push(
    new DynamicStructuredTool({
      name: 'memuSearch',
      description: 'Semantic search across MemU.',
      schema: z.object({ query: z.string(), limit: z.number().int().positive().optional() }),
      func: async (input) => factories.memuSearch(input),
    }),
  );
  tools.push(
    new DynamicStructuredTool({
      name: 'memuCategories',
      description: 'List MemU categories.',
      schema: z.object({}),
      func: async () => factories.memuCategories(),
    }),
  );
  return tools;
}

export interface BuildLightRecordAgentOptions {
  systemPrompt: string;
  deps: RecordDeps;
  baseToolFactories: RecordToolFactories;
  usageLimits: DeepAgentFactoryUsageLimits;
  /** Defaults to ['dailys/*.md']. */
  allowedPatterns?: string[];
}

const DEFAULT_WRITE_PATTERNS = ['dailys/*.md'];

export function buildLightRecordAgent(
  factory: DeepAgentFactory,
  options: BuildLightRecordAgentOptions,
): DeepAgentFactoryAgent<typeof RecordResultSchema> {
  const allowedPatterns = options.allowedPatterns ?? DEFAULT_WRITE_PATTERNS;
  const tools: DynamicStructuredTool[] = [
    ...buildBaseTools(options.baseToolFactories),
    buildWriteFileTool(options.deps, allowedPatterns),
    buildUpdateReinforcementTool(options.deps, options.baseToolFactories),
    buildFlagContradictionTool(options.deps, options.baseToolFactories),
  ];
  return factory.create({
    systemPrompt: options.systemPrompt,
    tools,
    output: RecordResultSchema,
    retries: 2,
    outputRetries: 3,
    usageLimits: options.usageLimits,
  });
}
