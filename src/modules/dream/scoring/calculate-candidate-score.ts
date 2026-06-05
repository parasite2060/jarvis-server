/**
 * Pure deterministic deep-dream candidate scoring (Story 13.11 / Q6).
 *
 * Mirrors Python `services/deep_dream.py:332-361` byte-for-byte. NO LLM,
 * NO DB, NO FS. Used by `scoreCandidates` activity to score Phase 1
 * candidates before they reach Phase 3's prompt-conveyed thresholds.
 *
 * # Q6 RESOLVED 2026-05-08: weights configurable via env vars
 *   `SCORING_WEIGHT_*` and `SCORING_DECAY_RATE` env vars (Joi-validated)
 *   override the defaults; Python's defaults baked in here. The epic AC
 *   mentioning "configurable via config.yml" is doc drift — Python doesn't
 *   wire config.yml for scoring.
 *
 * # Q7 RESOLVED 2026-05-08: no PROMOTE/PRUNE/CONTRADICTION classification
 *   The function returns a float only. Phase 3's prompt reads the
 *   `[score=X.XXX, reinforced=N]` markers + `[CONTRADICTION]` flag and
 *   applies the (prompt-conveyed) thresholds. The epic AC's classification
 *   field is doc drift relative to Python.
 *
 * # Hard-coded constants in production
 *   `score_candidates.py:16-17` passes `days_since_reinforced=0` AND
 *   `in_active_project=true` regardless of input. This means recency=1.0
 *   and relevance=1.0 in production — the contributing constant is 0.45.
 *   The function preserves the parameters for testability + future use,
 *   but the activity's call site hard-codes them.
 */

/** Default weights from Python `DEFAULT_SCORING_WEIGHTS`. */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  frequency: 0.25,
  recency: 0.25,
  relevance: 0.2,
  consistency: 0.2,
  breadth: 0.1,
};

/** Default Ebbinghaus decay rate from Python `DEFAULT_DECAY_RATE`. */
export const DEFAULT_DECAY_RATE = 0.03;

export interface ScoringWeights {
  frequency: number;
  recency: number;
  relevance: number;
  consistency: number;
  breadth: number;
}

export interface CalculateCandidateScoreInput {
  reinforcement_count: number;
  days_since_reinforced: number;
  in_active_project: boolean;
  has_contradiction: boolean;
  /** Number of source sessions / contexts the candidate appeared in. */
  context_count: number;
  /** When true, score short-circuits to 1.0 (terminal node). */
  is_reference?: boolean;
  /** When true, score short-circuits to 1.0 (anti-repetition). */
  is_failed_lesson?: boolean;
}

export interface CalculateCandidateScoreOptions {
  weights?: Partial<ScoringWeights>;
  decay_rate?: number;
}

/**
 * Deterministic candidate score in [0, 1]. Mirrors Python:
 *
 *   score = w.frequency * freq
 *         + w.recency * recency
 *         + w.relevance * relevance
 *         + w.consistency * consistency
 *         + w.breadth * breadth
 *
 * with components:
 *   freq        = min(reinforcement_count / 10, 1.0)
 *   recency     = exp(-decay_rate * days_since_reinforced)
 *   relevance   = 1.0 if in_active_project else 0.3
 *   consistency = 0.0 if has_contradiction else 1.0
 *   breadth     = min(context_count / 5, 1.0)
 *
 * Special-case terminals (short-circuit before the formula):
 *   is_reference     → 1.0  (terminal node, never pruned)
 *   is_failed_lesson → 1.0  (anti-repetition, never pruned)
 */
export function calculateCandidateScore(input: CalculateCandidateScoreInput, options: CalculateCandidateScoreOptions = {}): number {
  if (input.is_reference === true) return 1.0;
  if (input.is_failed_lesson === true) return 1.0;

  const w: ScoringWeights = {
    frequency: options.weights?.frequency ?? DEFAULT_SCORING_WEIGHTS.frequency,
    recency: options.weights?.recency ?? DEFAULT_SCORING_WEIGHTS.recency,
    relevance: options.weights?.relevance ?? DEFAULT_SCORING_WEIGHTS.relevance,
    consistency: options.weights?.consistency ?? DEFAULT_SCORING_WEIGHTS.consistency,
    breadth: options.weights?.breadth ?? DEFAULT_SCORING_WEIGHTS.breadth,
  };
  const decayRate = options.decay_rate ?? DEFAULT_DECAY_RATE;

  const freq = Math.min(input.reinforcement_count / 10.0, 1.0);
  const recency = Math.exp(-decayRate * input.days_since_reinforced);
  const relevance = input.in_active_project ? 1.0 : 0.3;
  const consistency = input.has_contradiction ? 0.0 : 1.0;
  const breadth = Math.min(input.context_count / 5.0, 1.0);

  return w.frequency * freq + w.recency * recency + w.relevance * relevance + w.consistency * consistency + w.breadth * breadth;
}
