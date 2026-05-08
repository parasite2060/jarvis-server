/**
 * Light-extraction agent builder (Story 13.10 / Task 7).
 *
 * Wraps `DeepAgentFactory.create({...})` with the 8 store-tools + 7 base
 * tools that the extraction system prompt expects (camelCase tool names per
 * Q3.b). The store-tools mutate `deps.session_*` collections; the
 * post-run assembly in the activity overwrites the agent's own
 * `output.session_log` with a fresh `SessionLogEntry` populated from `deps`.
 *
 * # Q7 binding (RESOLVED 2026-05-08): camelCase tool names
 *   `storeContext` / `storeDecision` / `storeLesson` / `storeActionItem` /
 *   `storeKeyExchange` / `storeConcept` / `storeConnection` /
 *   `storeSessionMemory`. Matches the system-prompt body in
 *   `prompts/light-extraction.md`.
 */
import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { DeepAgentFactory, type DeepAgentFactoryAgent, type DeepAgentFactoryUsageLimits } from 'src/shared/agents/deep-agent.factory';
import { ExtractionSummarySchema, type MemoryItem, type VaultTarget } from './extraction-summary.schema';

/**
 * Agent dependency state — mirrors Python `DreamDeps`. Mutated by store
 * tools; consumed by post-run assembly in `runExtraction` activity.
 */
export interface DreamDeps {
  session_id: string;
  session_context: string;
  session_decisions: string[];
  session_lessons: string[];
  session_failed_lessons: Array<Record<string, string>>;
  session_action_items: string[];
  session_key_exchanges: string[];
  session_concepts: Array<Record<string, string>>;
  session_connections: Array<Record<string, string>>;
  memories: MemoryItem[];
  /** Set inside the activity body before run; used by `storeSessionMemory` for `MemoryItem.source_date`. */
  today_iso: string;
}

export interface ExtractionToolFactories {
  /** Reads a vault file. Caller injects with the activity's vault helper. */
  readFile: (input: { path: string; offset?: number; limit?: number }) => Promise<string>;
  grep: (input: { pattern: string; path?: string }) => Promise<string>;
  listFiles: (input: { path?: string }) => Promise<string>;
  fileInfo: (input: { path: string }) => Promise<string>;
  readFrontmatter: (input: { path: string }) => Promise<string>;
  memuSearch: (input: { query: string; limit?: number }) => Promise<string>;
  memuCategories: () => Promise<string>;
}

const VAULT_TARGETS: VaultTarget[] = [
  'memory',
  'decisions',
  'patterns',
  'projects',
  'templates',
  'concepts',
  'connections',
  'lessons',
  'references',
  'reviews',
];

const MEMORY_CATEGORIES = ['decisions', 'preferences', 'patterns', 'corrections', 'facts'] as const;

const ALLOWED_RELATIONSHIP_TYPES = ['extends', 'contradicts', 'supports', 'inspired_by', 'supersedes', 'derived_from', 'addresses_gap'] as const;

/**
 * Build the 8 store-tools that mutate `deps`. Each tool returns a short
 * confirmation string for the LLM; the actual side effect is the deps
 * mutation captured in the closure.
 */
function buildStoreTools(deps: DreamDeps): DynamicStructuredTool[] {
  const tools: DynamicStructuredTool[] = [];

  tools.push(
    new DynamicStructuredTool({
      name: 'storeContext',
      description: 'Store the session context — a brief 1-3 sentence description of what the session was about.',
      schema: z.object({ content: z.string() }),
      func: async (input) => {
        deps.session_context = input.content;
        return `Stored session context (${input.content.length} chars)`;
      },
    }),
  );

  tools.push(
    new DynamicStructuredTool({
      name: 'storeDecision',
      description: 'Store a decision made during the session with reasoning and "Revisit if" condition.',
      schema: z.object({ decision: z.string(), reasoning: z.string() }),
      func: async (input) => {
        const combined = `${input.decision} — ${input.reasoning}`;
        deps.session_decisions.push(combined);
        deps.memories.push({
          content: input.decision,
          reasoning: input.reasoning,
          vault_target: 'decisions',
          source_date: deps.today_iso,
        });
        return `Stored decision: "${input.decision.slice(0, 60)}..."`;
      },
    }),
  );

  tools.push(
    new DynamicStructuredTool({
      name: 'storeLesson',
      description: 'Store a lesson learned. Use outcome="failed" + failureReason for things that did not work.',
      schema: z.object({
        lesson: z.string(),
        outcome: z.enum(['success', 'failed', 'mixed']).optional(),
        failureReason: z.string().optional(),
      }),
      func: async (input) => {
        deps.session_lessons.push(input.lesson);
        if (input.outcome === 'failed' && input.failureReason !== undefined) {
          deps.session_failed_lessons.push({
            lesson: input.lesson,
            outcome: input.outcome,
            failure_reason: input.failureReason,
          });
        }
        return `Stored lesson: "${input.lesson.slice(0, 60)}..."`;
      },
    }),
  );

  tools.push(
    new DynamicStructuredTool({
      name: 'storeActionItem',
      description: 'Store a follow-up task or next step identified during the session.',
      schema: z.object({ action: z.string() }),
      func: async (input) => {
        deps.session_action_items.push(input.action);
        return `Stored action item: "${input.action.slice(0, 60)}..."`;
      },
    }),
  );

  tools.push(
    new DynamicStructuredTool({
      name: 'storeKeyExchange',
      description: 'Store a notable question/answer pair or pivotal conversation turn.',
      schema: z.object({ exchange: z.string() }),
      func: async (input) => {
        deps.session_key_exchanges.push(input.exchange);
        return `Stored key exchange (${input.exchange.length} chars)`;
      },
    }),
  );

  tools.push(
    new DynamicStructuredTool({
      name: 'storeConcept',
      description: 'Store a concept discussed in the session. Creates a knowledge base entry under concepts.',
      schema: z.object({ name: z.string(), description: z.string() }),
      func: async (input) => {
        deps.session_concepts.push({ name: input.name, description: input.description });
        deps.memories.push({
          content: `${input.name}: ${input.description}`,
          reasoning: null,
          vault_target: 'concepts',
          source_date: deps.today_iso,
        });
        return `Stored concept: "${input.name}"`;
      },
    }),
  );

  tools.push(
    new DynamicStructuredTool({
      name: 'storeConnection',
      description: 'Store a connection between two concepts. Optional relationshipType classifies the edge.',
      schema: z.object({
        conceptA: z.string(),
        conceptB: z.string(),
        relationship: z.string(),
        relationshipType: z.enum(ALLOWED_RELATIONSHIP_TYPES).default('supports'),
      }),
      func: async (input) => {
        const rt = input.relationshipType ?? 'supports';
        deps.session_connections.push({
          concept_a: input.conceptA,
          concept_b: input.conceptB,
          relationship: input.relationship,
          relationship_type: rt,
        });
        deps.memories.push({
          content: `${input.conceptA} ↔ ${input.conceptB}: ${input.relationship}`,
          reasoning: null,
          vault_target: 'connections',
          source_date: deps.today_iso,
        });
        return `Stored connection: ${input.conceptA} ↔ ${input.conceptB}`;
      },
    }),
  );

  tools.push(
    new DynamicStructuredTool({
      name: 'storeSessionMemory',
      description: 'Store a session memory — general observations, preferences, facts, or corrections.',
      schema: z.object({
        category: z.enum(MEMORY_CATEGORIES),
        content: z.string(),
        vaultTarget: z.enum(VAULT_TARGETS as [VaultTarget, ...VaultTarget[]]),
        sourceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        reasoning: z.string().optional(),
      }),
      func: async (input) => {
        deps.memories.push({
          content: input.content,
          reasoning: input.reasoning ?? null,
          vault_target: input.vaultTarget,
          source_date: input.sourceDate,
        });
        return `Stored ${input.category} memory: "${input.content.slice(0, 60)}..."`;
      },
    }),
  );

  return tools;
}

/**
 * Build the 7 base tools (vault read + MemU access). Each delegates to a
 * caller-injected handler so the activity controls FS / HTTP boundaries.
 */
function buildBaseTools(factories: ExtractionToolFactories): DynamicStructuredTool[] {
  const tools: DynamicStructuredTool[] = [];

  tools.push(
    new DynamicStructuredTool({
      name: 'readFile',
      description: 'Read a vault file. Optional offset/limit for line ranges.',
      schema: z.object({ path: z.string(), offset: z.number().int().nonnegative().optional(), limit: z.number().int().positive().optional() }),
      func: async (input) => factories.readFile(input),
    }),
  );

  tools.push(
    new DynamicStructuredTool({
      name: 'grep',
      description: 'Recursively search vault files for a regex pattern. Capped at 100 matches.',
      schema: z.object({ pattern: z.string(), path: z.string().optional() }),
      func: async (input) => factories.grep(input),
    }),
  );

  tools.push(
    new DynamicStructuredTool({
      name: 'listFiles',
      description: 'List the contents of a vault directory.',
      schema: z.object({ path: z.string().optional() }),
      func: async (input) => factories.listFiles(input),
    }),
  );

  tools.push(
    new DynamicStructuredTool({
      name: 'fileInfo',
      description: "Get a vault file's line count, character count, and estimated token count.",
      schema: z.object({ path: z.string() }),
      func: async (input) => factories.fileInfo(input),
    }),
  );

  tools.push(
    new DynamicStructuredTool({
      name: 'readFrontmatter',
      description: 'Extract YAML frontmatter (between --- markers) from a vault file.',
      schema: z.object({ path: z.string() }),
      func: async (input) => factories.readFrontmatter(input),
    }),
  );

  tools.push(
    new DynamicStructuredTool({
      name: 'memuSearch',
      description: 'Semantic search across MemU-managed knowledge.',
      schema: z.object({ query: z.string(), limit: z.number().int().positive().optional() }),
      func: async (input) => factories.memuSearch(input),
    }),
  );

  tools.push(
    new DynamicStructuredTool({
      name: 'memuCategories',
      description: 'List the available MemU memory categories.',
      schema: z.object({}),
      func: async () => factories.memuCategories(),
    }),
  );

  return tools;
}

export interface BuildLightExtractionAgentOptions {
  systemPrompt: string;
  deps: DreamDeps;
  baseToolFactories: ExtractionToolFactories;
  usageLimits: DeepAgentFactoryUsageLimits;
}

/**
 * Builds the light-extraction agent. Caller (the `runExtraction` activity)
 * provides the system prompt body (loaded by `PromptCacheService`), the
 * mutable `deps` object, the base-tool factories, and the per-phase usage
 * limits from `AppConfigService.lightExtractionLimits`.
 */
export function buildLightExtractionAgent(
  factory: DeepAgentFactory,
  options: BuildLightExtractionAgentOptions,
): DeepAgentFactoryAgent<typeof ExtractionSummarySchema> {
  const tools = [...buildBaseTools(options.baseToolFactories), ...buildStoreTools(options.deps)];
  return factory.create({
    systemPrompt: options.systemPrompt,
    tools,
    output: ExtractionSummarySchema,
    retries: 2,
    outputRetries: 3,
    usageLimits: options.usageLimits,
  });
}
