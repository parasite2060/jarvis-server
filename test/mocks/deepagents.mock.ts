/**
 * Jest module mock for `deepagents` (Story 13.10).
 *
 * The real `deepagents` package transitively imports `is-network-error`
 * (an ESM-only module via `p-retry` / `@langchain/langgraph-sdk`) which
 * Jest's CJS test environment cannot parse. For unit-test purposes the
 * factory wraps the createDeepAgent call; we don't need a real LLM agent
 * in unit tests — we just need a callable that returns a stub.
 *
 * Wired in `jest.config.ts` via `moduleNameMapper` so every spec that
 * imports `deepagents` (transitively or directly) gets this stub.
 */
export const createDeepAgent = (_params?: unknown): { invoke: (...args: unknown[]) => Promise<unknown> } => ({
  invoke: async () => ({ structuredResponse: {} }),
});
