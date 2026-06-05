/**
 * Per-phase budget for the deepagents factory.
 *
 * Sourced from `JARVIS_<PHASE>_MAX_TOKENS` and `JARVIS_<PHASE>_MAX_ITERATIONS`
 * env vars validated by the Joi schema.
 *
 * See `_bmad-output/planning-artifacts/design/config-and-env.md §3`.
 */
export interface UsageLimits {
  maxTokens: number;
  maxIterations: number;
}
