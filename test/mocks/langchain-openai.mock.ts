/**
 * Jest module mock for `@langchain/openai` (Story 13.10 + Addendum 1+2).
 *
 * Same rationale as `deepagents.mock.ts` — `@langchain/openai` transitively
 * pulls in ESM-only modules. Unit tests don't need a real Azure / OpenRouter /
 * llama.cpp client; the stubs are enough to satisfy the type signature.
 *
 * `AzureChatOpenAI` (Azure provider), `ChatOpenAI` (OpenRouter + llama.cpp).
 * Both are constructable; specs that need to assert constructor args spy on
 * the mock implementations directly.
 */
export class AzureChatOpenAI {
  constructor(public readonly params: unknown) {}
}

export class ChatOpenAI {
  constructor(public readonly params: unknown) {}
}
