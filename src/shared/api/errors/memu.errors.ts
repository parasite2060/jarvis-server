/**
 * Typed exceptions for the MemU client (Story 13.4 / AC #7).
 *
 * Mirrors Python `app/core/exceptions.py :: MemuError` and `MemuUnavailableError`.
 * Use cases let these bubble; the global exception filter chain (Story 13.1) maps
 * them to HTTP responses with the boilerplate-flat envelope (Decision B).
 *
 * `MemuError` carries the upstream HTTP status code so the filter can preserve it
 * (Python's `_handle_memu_error` does the same — `memory.py:142-149`).
 *
 * `MemuUnavailableError` is always mapped to HTTP 502 by the filter — Python's
 * `_handle_memu_unavailable` also hardcodes 502 (`memory.py:152-159`).
 */
export class MemuError extends Error {
  public readonly statusCode: number;
  public readonly detail: string;

  constructor(statusCode: number, detail: string) {
    super(detail);
    this.name = 'MemuError';
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

export class MemuUnavailableError extends Error {
  public readonly detail: string;

  constructor(detail: string = 'MemU server is unreachable') {
    super(detail);
    this.name = 'MemuUnavailableError';
    this.detail = detail;
  }
}
