/**
 * Zod schemas for the deep-dream Phase 1 (Light Sleep) agent's structured
 * output (Story 13.11).
 *
 * Field-for-field port of `components/jarvis-server/app/services/dream_models.py`
 * (`ScoredCandidate`, `LightSleepOutput`).
 *
 * # Q8 binding (RESOLVED 2026-05-08): snake_case keys
 *   Same as 13.10 light-dream schemas — JSONB byte-equivalence with the
 *   Python era requires snake_case. MC5 (output byte-equivalence) requires
 *   `dream_phases.output_json` to round-trip identically.
 */
import { z } from 'zod';

/**
 * ScoredCandidate — a single candidate memory from Phase 1.
 *
 * `reinforcement_count` (>=0) tracks how many independent sources
 * contributed this candidate. `contradiction_flag` is set when the
 * candidate contradicts an existing entry. `source_sessions` is the list
 * of session ids where the candidate was observed.
 *
 * NOTE: `score` is NOT in this schema — Phase 1 emits unscored candidates;
 * `scoreCandidates` activity computes the score and emits a separate
 * `ScoredCandidatesResult`.
 */
export const ScoredCandidateSchema = z.object({
  content: z.string(),
  category: z.string(),
  reinforcement_count: z.number().int().nonnegative().default(0),
  contradiction_flag: z.boolean().default(false),
  source_sessions: z.array(z.string()).default([]),
});

export type ScoredCandidate = z.infer<typeof ScoredCandidateSchema>;

/**
 * LightSleepOutput — Phase 1 LLM agent's structured output.
 *
 * `candidates` is the deduplicated, contradiction-flagged list. The
 * `duplicates_removed` and `contradictions_found` counters are surfaced
 * in the PR body and dream telemetry.
 */
export const LightSleepOutputSchema = z.object({
  candidates: z.array(ScoredCandidateSchema).default([]),
  duplicates_removed: z.number().int().nonnegative().default(0),
  contradictions_found: z.number().int().nonnegative().default(0),
});

export type LightSleepOutput = z.infer<typeof LightSleepOutputSchema>;
