/**
 * Zod schemas for the light-record agent's structured output (Story 13.10).
 *
 * Field-for-field port of `components/jarvis-server/app/services/dream_models.py`
 * (`RecordResult`, `FileAction`).
 *
 * # Q8 binding (RESOLVED 2026-05-08): snake_case keys
 *   Same as `extraction-summary.schema.ts` — JSONB byte-equivalence with the
 *   Python era requires snake_case property names.
 */
import { z } from 'zod';

/**
 * FileAction — a single file mutation reported by the record agent.
 *
 * `action` ∈ {create, append, update, skip}:
 *   - `create`: new daily-log file written by `writeFile` tool.
 *   - `append`: existing daily-log file appended (continuation session).
 *   - `update`: existing vault file's frontmatter mutated by
 *     `updateReinforcement` or `flagContradiction`.
 *   - `skip`: tool was called but no change was needed (e.g., reinforcement
 *     already at the cap).
 */
export const FileActionSchema = z.object({
  path: z.string(),
  action: z.enum(['create', 'append', 'update', 'skip']),
});

export type FileAction = z.infer<typeof FileActionSchema>;

/**
 * RecordResult — top-level structured output from the record agent.
 *
 * `files` is populated by post-run assembly from
 * `deps.recordOutput.session_log_writes` (mirroring Python's pattern), NOT
 * by the LLM directly. The LLM's `files` field is overwritten at run end so
 * the activity has authoritative provenance for `commitAndPr` to consume.
 */
export const RecordResultSchema = z.object({
  files: z.array(FileActionSchema).default([]),
  summary: z.string().default(''),
});

export type RecordResult = z.infer<typeof RecordResultSchema>;
