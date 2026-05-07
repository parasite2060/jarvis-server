/**
 * POST /memory/search response data (Story 13.4 / AC #2 / Q4).
 *
 * Wire format snake_case (Q4) — single-word property names collapse identically.
 * Mirrors Python `MemorySearchData`.
 */

export interface SearchResult {
  content: string;
  relevance: number;
  source?: string;
  metadata?: Record<string, unknown>;
}

export class SearchMemoryResponse {
  results: SearchResult[];
  query: string;
  method: string;

  constructor(init: { results: SearchResult[]; query: string; method: string }) {
    this.results = init.results;
    this.query = init.query;
    this.method = init.method;
  }
}
