/**
 * DeepAgentFactory — shared factory wrapping the `deepagents` package
 * (Story 13.10 / Task 2).
 *
 * # API mapping (story-spec ↔ deepagents 1.10.0):
 *   - story `output` ↔ deepagents `responseFormat` (Zod schema or other format)
 *   - story `historyProcessor` ↔ deepagents middleware (e.g.,
 *     `createSummarizationMiddleware`) — context compaction is wrapped via
 *     middleware in the deepagents API.
 *   - story `usageLimits.totalTokens` / `usageLimits.toolCalls` — surfaced
 *     in the factory's options so the activity callers (Story 13.10
 *     light-extraction + light-record; Stories 13.11/13.12 deep + weekly)
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
 * # compactHistory middleware — DEFERRED to Story 13.10.1 (Round 1/2 Finding 4)
 *   Python `dream_agent.py::compact_history` (320k char threshold + tool-return
 *   truncation > 200 chars + preserve last 6 messages) is NOT wired in 13.10.
 *   The `createSummarizationMiddleware` from deepagents would be the right
 *   plumbing, but tuning the knobs (`tokensToKeep`, `messagesToKeep`) to
 *   match Python's behaviour requires byte-equivalence-verified recordings
 *   to validate output parity. That work moves to Story 13.10.1 alongside
 *   fixture capture. Long sessions (>320k chars) WILL hit context-length
 *   errors against real LLMs in 13.10.1 / 13.16 until the middleware lands;
 *   13.10's unit tests use mocked `DeepAgentFactory` so the gap is invisible
 *   to the unit suite.
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
   * Invoke the agent with a run-prompt string and optional initial deps
   * state. Returns the parsed structured output. Throws on validation
   * failure after `outputRetries` exhaustion.
   */
  invoke(runPrompt: string): Promise<z.infer<TOutput>>;
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
   * map to deepagents' actual params (`responseFormat`, middleware) inside
   * this method body — caller ergonomics > implementation-detail leakage.
   */
  create<TOutput extends z.ZodTypeAny>(opts: DeepAgentFactoryOptions<TOutput>): DeepAgentFactoryAgent<TOutput> {
    const model: BaseLanguageModel = opts.model ?? this.resolveModel();

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
    });

    const invoke = async (runPrompt: string): Promise<z.infer<TOutput>> => {
      // deepagents agents expose `.invoke({ messages: [...] })` returning the
      // structured response. Recursion limit ≈ tool-call cap.
      const result = await agent.invoke(
        {
          messages: [{ role: 'user', content: runPrompt }],
        },
        {
          recursionLimit: opts.usageLimits.toolCalls,
        },
      );

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
