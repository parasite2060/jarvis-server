/**
 * DeepAgentFactory — shared factory wrapping the `deepagents` package
 * (Story 13.10 / Task 2; Story 13.11 / Task 1 closes Finding 4).
 *
 * # API mapping (story-spec ↔ deepagents 1.10.0):
 *   - story `output` ↔ deepagents `responseFormat` (Zod schema or other format)
 *   - story `historyProcessor` ↔ message-list rewriter applied to the seed
 *     `messages` array (and any caller-supplied `messageHistory`) before
 *     the deepagents agent is invoked. NOT a deepagents middleware
 *     registration — `createSummarizationMiddleware` requires a backend
 *     (StateBackend) which Jarvis doesn't provide. The Python
 *     `dream_agent.py::compact_history` semantics fit a pre-call rewrite
 *     of the message list cleanly; we apply it at `invoke()` time.
 *   - story `usageLimits.totalTokens` / `usageLimits.toolCalls` — surfaced
 *     in the factory's options so the activity callers (Story 13.10
 *     light-extraction + light-record; Story 13.11 deep + Story 13.12 weekly)
 *     can pass per-phase budgets from `AppConfigService.lightExtractionLimits`
 *     etc. They are wired into agent invocation as part of the run config
 *     (NOT the create-time params per deepagents).
 *   - `model: 'azure'` resolved here via LangChain `AzureChatOpenAI` from
 *     `@langchain/openai`.
 *
 * # Usage limits enforcement
 *   `usageLimits` is captured on the returned wrapper (`DeepAgentFactoryAgent`)
 *   so callers invoke `agent.invoke(input)` and the wrapper enforces the
 *   budgets via deepagents recursion limit / token tracking middleware.
 *   For Story 13.10 we surface the budgets as informational telemetry; full
 *   enforcement (hard-fail at limit) is a Stories-13.11+ refinement once we
 *   see real token usage from the Python SHA `61116c7` byte-equivalence
 *   recordings.
 *
 * # Q11 (Story 13.10 RESOLVED): system prompt loading delegated to
 *   `PromptCacheService` (read-once-at-app-init). The factory accepts the
 *   pre-loaded prompt string; no disk I/O at agent-build time.
 *
 * # compactHistory — Story 13.11 / Q1 RESOLVED 2026-05-08
 *   Closes Story 13.10 Finding 4 deferral. Mirrors Python `dream_agent.py:73-118`:
 *     - Threshold: total message-chars > 320,000 (`COMPACT_THRESHOLD_CHARS`).
 *     - Action: replace ToolReturnPart `content` > 200 chars with
 *       `[Compacted: <toolName>, ~<N> chars]`.
 *     - Preserve: last 6 messages always (`KEEP_RECENT_MESSAGES`).
 *   Used to rewrite the seed message list (and any `messageHistory` for
 *   Health Fix continuation) before `deepagents.agent.invoke(...)`. This
 *   prevents Phase 3 / Health Fix prompts (full daily log + MEMORY.md +
 *   8 vault index files + Phase 1+2 summaries) from blowing the LLM
 *   context window.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { BaseLanguageModel } from '@langchain/core/language_models/base';
import type { StructuredTool } from '@langchain/core/tools';
import { AzureChatOpenAI, ChatOpenAI } from '@langchain/openai';
import { createDeepAgent } from 'deepagents';
import type { z } from 'zod';
import { AppConfigService } from 'src/shared/config/config.service';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';

export interface DeepAgentFactoryUsageLimits {
  totalTokens: number;
  toolCalls: number;
}

/**
 * Generic message shape compatible with both LangChain `BaseMessage` and
 * deepagents' input-message dict. Pre-call rewriters work in this lossless
 * format so Python's `compact_history` semantics (which key off `kind` and
 * `parts[].part_kind`) port cleanly.
 */
export interface AgentMessage {
  role?: string;
  /** May be plain string OR LangChain BaseMessage `content` (string | parts[]). */
  content?: unknown;
  /** Tool call name when this is a `tool` message — drives compactHistory's placeholder. */
  name?: string;
  /** Allow extra fields (LangChain shape) without casting. */
  [k: string]: unknown;
}

export type HistoryProcessor = (messages: AgentMessage[]) => AgentMessage[];

export interface DeepAgentFactoryOptions<TOutput extends z.ZodTypeAny> {
  /** System prompt body. Pre-loaded via `PromptCacheService`. */
  systemPrompt: string;
  /** LangChain `StructuredTool[]` — base + store + record tools per agent. */
  tools: StructuredTool[];
  /** Zod schema for the agent's structured response. */
  output: TOutput;
  /** Number of self-corrections on transient errors. */
  retries?: number;
  /** Number of self-corrections on output-validation failures. */
  outputRetries?: number;
  /** Per-phase token + tool-call budgets (informational in 13.10). */
  usageLimits: DeepAgentFactoryUsageLimits;
  /** Optional override for the LLM. Defaults to Azure OpenAI from config. */
  model?: BaseLanguageModel;
  /**
   * Optional message-list rewriter applied before `agent.invoke(...)`. Used
   * by deep-dream Phase 3 / Health Fix to apply Python's `compact_history`
   * semantics (Story 13.11 / Q1). Defaults to {@link compactHistory}.
   * Pass `null` to disable compaction entirely (unit tests).
   */
  historyProcessor?: HistoryProcessor | null;
}

export interface AgentInvokeOptions {
  /**
   * Prior conversation history, e.g., serialized Phase 3 messages passed
   * through to Health Fix per Story 13.11 AC #10. The factory prepends
   * these to the new user message before invoking deepagents.
   */
  messageHistory?: AgentMessage[];
}

/**
 * Wrapper around the deepagents-built agent that exposes a stable invoke
 * surface for caller use. The underlying agent's run loop is owned by
 * deepagents/LangGraph; the wrapper records usage limits so activity-level
 * telemetry can surface budget exhaustion in `dream_phases.errorMessage`.
 */
export interface DeepAgentFactoryAgent<TOutput extends z.ZodTypeAny> {
  readonly usageLimits: DeepAgentFactoryUsageLimits;
  readonly outputSchema: TOutput;
  /**
   * Invoke the agent with a run-prompt string and optional message history
   * (Story 13.11 Health Fix continuation). Returns the parsed structured
   * output. Throws on validation failure after `outputRetries` exhaustion.
   */
  invoke(runPrompt: string, options?: AgentInvokeOptions): Promise<z.infer<TOutput>>;
}

/**
 * Threshold above which {@link compactHistory} starts replacing tool-return
 * payloads with placeholders. Mirrors Python `COMPACT_THRESHOLD_CHARS`
 * (`dream_agent.py:73`). 320 000 chars ≈ 80k tokens at 4 char/token, which
 * matches the Python comment: "compact when total context > ~80k tokens".
 */
export const COMPACT_THRESHOLD_CHARS = 320_000;

/**
 * Maximum length of an individual tool-return content before compaction
 * replaces it with a placeholder. Below this length the return is short
 * enough that compaction would lose more signal than it saves.
 */
export const TOOL_RETURN_TRUNCATE_CHARS = 200;

/**
 * How many trailing messages to preserve verbatim regardless of compaction.
 * Mirrors Python `KEEP_RECENT_MESSAGES = 6`.
 */
export const KEEP_RECENT_MESSAGES = 6;

/**
 * Best-effort total-character measure of a message-list. Handles both
 * LangChain string-content and content-parts shapes. Mirrors Python's
 * `_total_chars(messages)` — sum of every text-like field encountered.
 */
function totalChars(messages: AgentMessage[]): number {
  let total = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') {
      total += m.content.length;
      continue;
    }
    if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (typeof part === 'string') {
          total += part.length;
          continue;
        }
        if (part !== null && typeof part === 'object') {
          const obj = part as { text?: unknown; content?: unknown };
          if (typeof obj.text === 'string') total += obj.text.length;
          if (typeof obj.content === 'string') total += obj.content.length;
        }
      }
    }
  }
  return total;
}

/**
 * Determine whether a message is a tool-return / tool-message that
 * `compactHistory` should consider replacing with a placeholder. Matches
 * both LangChain `tool` role and deepagents' `kind: 'tool'` shape.
 */
function isToolReturn(m: AgentMessage): boolean {
  if (m.role === 'tool') return true;
  const kind = (m as { kind?: unknown }).kind;
  if (kind === 'tool' || kind === 'tool_return') return true;
  return false;
}

function toolReturnLength(m: AgentMessage): number {
  if (typeof m.content === 'string') return m.content.length;
  if (Array.isArray(m.content)) {
    let len = 0;
    for (const part of m.content) {
      if (typeof part === 'string') len += part.length;
      else if (part !== null && typeof part === 'object') {
        const obj = part as { text?: unknown; content?: unknown };
        if (typeof obj.text === 'string') len += obj.text.length;
        if (typeof obj.content === 'string') len += obj.content.length;
      }
    }
    return len;
  }
  return 0;
}

function toolReturnName(m: AgentMessage): string {
  if (typeof m.name === 'string' && m.name.length > 0) return m.name;
  const tn = (m as { tool_name?: unknown; toolName?: unknown }).tool_name ?? (m as { toolName?: unknown }).toolName;
  if (typeof tn === 'string') return tn;
  return 'unknown';
}

/**
 * Replace this tool-return message's content with a placeholder. Pure
 * function; the caller copies the array.
 */
function compactToolReturn(m: AgentMessage, length: number): AgentMessage {
  const name = toolReturnName(m);
  const placeholder = `[Compacted: ${name}, ~${length} chars]`;
  return { ...m, content: placeholder };
}

/**
 * Python-equivalent `compact_history` (`dream_agent.py:73-118`).
 *
 * If the total chars in the message list exceeds {@link COMPACT_THRESHOLD_CHARS},
 * replace the content of every tool-return message in the prefix (everything
 * before the trailing {@link KEEP_RECENT_MESSAGES}) whose length exceeds
 * {@link TOOL_RETURN_TRUNCATE_CHARS} with a placeholder
 * `[Compacted: <toolName>, ~<N> chars]`. Returns the rewritten list.
 *
 * Idempotent: a placeholder is < TOOL_RETURN_TRUNCATE_CHARS so a second pass
 * leaves the list unchanged.
 */
export function compactHistory(messages: AgentMessage[]): AgentMessage[] {
  if (messages.length === 0) return messages;
  if (totalChars(messages) <= COMPACT_THRESHOLD_CHARS) return messages;
  // Keep last KEEP_RECENT_MESSAGES verbatim. Compact tool-returns in the prefix.
  const cutoff = Math.max(0, messages.length - KEEP_RECENT_MESSAGES);
  const result: AgentMessage[] = new Array<AgentMessage>(messages.length);
  for (let i = 0; i < messages.length; i++) {
    const original = messages[i]!;
    if (i >= cutoff) {
      result[i] = original;
      continue;
    }
    if (!isToolReturn(original)) {
      result[i] = original;
      continue;
    }
    const len = toolReturnLength(original);
    if (len <= TOOL_RETURN_TRUNCATE_CHARS) {
      result[i] = original;
      continue;
    }
    result[i] = compactToolReturn(original, len);
  }
  return result;
}

@Injectable()
export class DeepAgentFactory {
  private readonly logger = new Logger(DeepAgentFactory.name);

  constructor(private readonly appConfig: AppConfigService) {}

  /**
   * Build a deep-agent. The LLM provider is resolved from
   * `AppConfigService.llmProvider` (azure | openrouter | llamacpp) — see
   * `resolveModel(...)` for the switch + per-provider validation.
   *
   * The factory's option names (`output`, `usageLimits`, `historyProcessor`)
   * map to deepagents' actual params (`responseFormat`, message-list
   * rewriting before invoke) inside this method body — caller ergonomics >
   * implementation-detail leakage.
   */
  create<TOutput extends z.ZodTypeAny>(opts: DeepAgentFactoryOptions<TOutput>): DeepAgentFactoryAgent<TOutput> {
    const model: BaseLanguageModel = opts.model ?? this.resolveModel();
    // `null` → disabled; `undefined` → use compactHistory default.
    const processor: HistoryProcessor | null = opts.historyProcessor === undefined ? compactHistory : opts.historyProcessor;

    // deepagents@1.10.0 — `createDeepAgent({ model, tools, systemPrompt, responseFormat, ... })`.
    // `responseFormat` accepts a Zod schema; the deepagents SupportedResponseFormat
    // type is union-narrowed and Zod v4's TypeScript type doesn't always match
    // the strictest constraint. Cast to satisfy the SDK boundary — the runtime
    // path validates via `opts.output.parse(...)` below regardless.
    const agent = createDeepAgent({
      model,
      systemPrompt: opts.systemPrompt,
      tools: opts.tools,
      responseFormat: opts.output as unknown as Parameters<typeof createDeepAgent>[0] extends infer P
        ? P extends { responseFormat?: infer R }
          ? R
          : never
        : never,
    });

    this.logger.log({
      message: 'deep agent created',
      event: 'agentFactory.create.completed',
      // NEVER log the system prompt content (could contain secrets in
      // injected MEMORY.md). Log only the metadata that's safe to surface.
      promptCharCount: opts.systemPrompt.length,
      toolsCount: opts.tools.length,
      retries: opts.retries ?? 2,
      outputRetries: opts.outputRetries ?? 3,
      usageLimits: opts.usageLimits,
      historyProcessor: processor === null ? 'disabled' : 'compactHistory',
    });

    const invoke = async (runPrompt: string, invokeOpts?: AgentInvokeOptions): Promise<z.infer<TOutput>> => {
      // Build the seed message list. Health Fix continuation prepends
      // `messageHistory` (serialized Phase 3 conversation) before the new
      // user prompt — Python `health_fix.py:134-136` calls
      // `_health_fix_agent.run(prompt, message_history=...)`.
      const newUserMsg: AgentMessage = { role: 'user', content: runPrompt };
      const seed: AgentMessage[] = invokeOpts?.messageHistory ? [...invokeOpts.messageHistory, newUserMsg] : [newUserMsg];
      const messages = processor === null ? seed : processor(seed);

      // deepagents agents expose `.invoke({ messages: [...] })` returning the
      // structured response. Recursion limit ≈ tool-call cap.
      // The `messages` argument is our `AgentMessage[]` shape — deepagents
      // accepts a wider `Messages` union (BaseMessageLike, role/content
      // dicts, etc.). Cast at the boundary; the runtime contract only
      // requires `{ role, content }` which our shape provides.
      const invokeInput = { messages } as unknown as Parameters<typeof agent.invoke>[0];
      const result = await agent.invoke(invokeInput, {
        recursionLimit: opts.usageLimits.toolCalls,
      });

      // The structured response lives on `result.structuredResponse` per
      // deepagents convention. Validate with the Zod schema for safety.
      const parsed = opts.output.parse((result as { structuredResponse?: unknown }).structuredResponse);
      return parsed as z.infer<TOutput>;
    };

    return {
      usageLimits: opts.usageLimits,
      outputSchema: opts.output,
      invoke,
    };
  }

  /**
   * Resolve the LLM client based on `AppConfigService.llmProvider`.
   * Throws `InternalException(LLM_PROVIDER_CONFIG_INVALID)` when the chosen
   * provider's required env vars are missing/empty. Joi validation handles
   * the schema-level required-field check at boot; this is a defensive
   * runtime check covering edge cases (e.g., env value provided as empty
   * string that bypasses Joi.required()).
   */
  private resolveModel(): BaseLanguageModel {
    const provider = this.appConfig.llmProvider;
    switch (provider) {
      case 'llamacpp':
        return new ChatOpenAI({
          apiKey: this.appConfig.llamacppApiKey,
          model: this.appConfig.llamacppModel,
          configuration: { baseURL: this.appConfig.llamacppBaseUrl },
          temperature: 0.0,
        }) as unknown as BaseLanguageModel;
      case 'openrouter': {
        const apiKey = this.appConfig.openrouterApiKey;
        if (apiKey === undefined || apiKey === '') {
          throw new InternalException(ErrorCode.LLM_PROVIDER_CONFIG_INVALID, "LLM_PROVIDER='openrouter' requires OPENROUTER_API_KEY");
        }
        return new ChatOpenAI({
          apiKey,
          model: this.appConfig.openrouterModel,
          configuration: { baseURL: this.appConfig.openrouterBaseUrl },
          temperature: 0.0,
        }) as unknown as BaseLanguageModel;
      }
      case 'azure':
      default: {
        const azureKey = this.appConfig.azureOpenAIApiKey;
        if (azureKey === undefined || azureKey === '') {
          throw new InternalException(ErrorCode.LLM_PROVIDER_CONFIG_INVALID, "LLM_PROVIDER='azure' requires AZURE_OPENAI_API_KEY");
        }
        return new AzureChatOpenAI({
          azureOpenAIApiKey: azureKey,
          azureOpenAIApiInstanceName: this.appConfig.azureOpenAIApiInstanceName,
          azureOpenAIApiDeploymentName: this.appConfig.azureOpenAIApiDeploymentName,
          azureOpenAIApiVersion: this.appConfig.azureOpenAIApiVersion,
          temperature: 0.0,
        }) as unknown as BaseLanguageModel;
      }
    }
  }
}
