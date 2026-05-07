/**
 * POST /memory/add response data (Story 13.4 / AC #4 / Q4).
 *
 * Snake_case TS property names directly per Q4 — NO `@Expose({ name: '...' })`.
 * Mirrors Python `MemoryAddData` (memory_proxy_schemas.py:46-49). The plugin's
 * `result.data.data?.memoryId` access path evaluates to `undefined` against this
 * snake_case field — known drift, plugin retrofit deferred to Story 13.16.6.
 */
export class AddMemoryResponse {
  memory_id: string;
  status: string;

  constructor(memoryId: string, status: string) {
    this.memory_id = memoryId;
    this.status = status;
  }
}
