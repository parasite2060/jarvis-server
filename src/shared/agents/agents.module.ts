/**
 * AgentsModule — global module exposing the shared LLM agent infrastructure
 * (Story 13.10 / Task 2).
 *
 * Exports `DeepAgentFactory` (wraps the `deepagents` package) and
 * `PromptCacheService` (boot-time prompt loader). Both are consumed by
 * dream activity services across Stories 13.10 / 13.11 / 13.12.
 *
 * `@Global()` — per architecture rule §7.5, business modules do not
 * re-import this; `dream.module.ts` injects `DeepAgentFactory` and
 * `PromptCacheService` directly via the global DI tree.
 */
import { Global, Module } from '@nestjs/common';
import { DeepAgentFactory } from './deep-agent.factory';
import { PromptCacheService } from './prompt-cache.service';

@Global()
@Module({
  providers: [DeepAgentFactory, PromptCacheService],
  exports: [DeepAgentFactory, PromptCacheService],
})
export class AgentsModule {}
