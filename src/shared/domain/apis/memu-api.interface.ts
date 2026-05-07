/**
 * MemU HTTP client domain interface (Story 13.4 / Q11 / Q7).
 *
 * Mirrors Python `app/services/memu_client.py` — `memu_retrieve(query, method)` and
 * `memu_memorize(messages, user_id, agent_id)`. The TS port keeps the `method` parameter
 * for forward compat even though Python ignores it server-side (line 36 of `memu_client.py`).
 *
 * The `Idempotency-Key` header on `memorize` is set by `MemuApiService` when
 * `opts.idempotencyKey` is supplied (Q7). Read calls (`retrieve`) MUST NOT send a key.
 *
 * Use cases inject the interface via the `MEMU_API` Symbol token, NEVER the impl class
 * (architecture.md §1.6, app-design §1.6).
 */

export const MEMU_API = Symbol('MEMU_API');

export interface MemuMessage {
  role: string;
  content: string;
}

export interface MemuRetrieveResultItem {
  content: string;
  relevance: number;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface MemuRetrieveResult {
  memories: MemuRetrieveResultItem[];
}

export interface MemuMemorizeOptions {
  userId?: string;
  agentId?: string;
  idempotencyKey?: string;
}

export interface MemuMemorizeResult {
  task_id?: string;
  [key: string]: unknown;
}

export interface IMemuApi {
  retrieve(query: string, method?: string): Promise<MemuRetrieveResult>;
  memorize(messages: MemuMessage[], opts?: MemuMemorizeOptions): Promise<MemuMemorizeResult>;
}
