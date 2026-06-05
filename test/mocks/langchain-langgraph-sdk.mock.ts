// Stub for @langchain/langgraph-sdk — used by deepagents only for remote LangGraph server calls.
// Local agent usage (createDeepAgent) never instantiates Client; this stub prevents
// Jest CJS runtime errors from langgraph-sdk's nested ESM-only dependencies.
export class Client {
  constructor(_params?: unknown) {}
}
