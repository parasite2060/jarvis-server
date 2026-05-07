/**
 * Transcript parser + token counter — STUB for Story 13.3.
 *
 * Story 13.10 (light-dream extraction) ports the full implementation from
 * Python `app/services/transcript_parser.py`. For 13.3 the helpers exist
 * only to keep the `IngestTranscriptUseCase` algorithm 1:1 with the Python
 * route handler — Postgres `parsed_text` and `token_count` columns get
 * sane-but-not-precise values populated.
 *
 * DO NOT use these for production cost estimates.
 */

export function parseTranscript(text: string): string {
  return text;
}

export function countTokensApproximate(text: string): number {
  return Math.ceil(text.length / 4);
}
