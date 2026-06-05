/**
 * Zod schemas for the light-extraction agent's structured output (Story 13.10).
 *
 * Field-for-field port of `components/jarvis-server/app/services/dream_models.py`
 * (`ExtractionSummary`, `SessionLogEntry`, `MemoryItem`, `VaultTarget`).
 *
 * # Q8 binding (RESOLVED 2026-05-08): snake_case keys
 *   The schemas use snake_case property names to preserve byte-equivalence
 *   with Python's `Pydantic.model_dump()` JSONB output stored in
 *   `dreams.session_log`. MC5 (output byte-equivalence) is non-negotiable;
 *   the JSONB column must round-trip identically to the Python era.
 *   This is a deliberate exception to TS naming conventions, justified by
 *   the same precedent as Story 13.4 / Q4 (memu wire format).
 */
import { z } from 'zod';

/**
 * VaultTarget — one of the canonical vault category folders.
 * Mirrors `dream_models.VaultTarget` Literal type.
 */
export const VaultTargetSchema = z.enum([
  'memory',
  'decisions',
  'patterns',
  'projects',
  'templates',
  'concepts',
  'connections',
  'lessons',
  'references',
  'reviews',
]);

export type VaultTarget = z.infer<typeof VaultTargetSchema>;

/**
 * MemoryItem — a single extractable memory with provenance.
 * snake_case keys preserved for JSONB byte-equivalence.
 */
export const MemoryItemSchema = z.object({
  content: z.string(),
  reasoning: z.string().nullable(),
  vault_target: VaultTargetSchema,
  // Python regex `^\d{4}-\d{2}-\d{2}$` — YYYY-MM-DD ISO date.
  source_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type MemoryItem = z.infer<typeof MemoryItemSchema>;

/**
 * Decision — captured by `storeDecision`. Stored as a flat string in
 * `decisions_made[]`. The `decision` + `reasoning` are concatenated by the
 * tool handler before append.
 */

/**
 * SessionLogEntry — the full structured log persisted to
 * `dreams.session_log` JSONB. Empty sections are `[]` or `""`, never null,
 * never omitted (mirrors Pydantic `default_factory=list` and `context: str = ""`).
 */
export const SessionLogEntrySchema = z.object({
  context: z.string().default(''),
  key_exchanges: z.array(z.string()).default([]),
  decisions_made: z.array(z.string()).default([]),
  lessons_learned: z.array(z.string()).default([]),
  // Azure gpt-5.x strict mode rejects open-ended maps (z.record renders
  // `propertyNames`, which is not permitted). These use fixed shapes mirroring
  // the store-tool payloads. Note: the LLM's own session_log is DISCARDED and
  // reassembled from `deps.session_*` (see run-extraction.activity), so these
  // shapes only need to satisfy the strict validator — the persisted JSONB is
  // unaffected (MC5 byte-equivalence preserved).
  failed_lessons: z
    .array(z.object({ lesson: z.string().nullable(), outcome: z.string().nullable(), failure_reason: z.string().nullable() }))
    .default([]),
  action_items: z.array(z.string()).default([]),
  concepts: z.array(z.object({ name: z.string().nullable(), description: z.string().nullable() })).default([]),
  connections: z
    .array(
      z.object({
        concept_a: z.string().nullable(),
        concept_b: z.string().nullable(),
        relationship: z.string().nullable(),
        relationship_type: z.string().nullable(),
      }),
    )
    .default([]),
  memories: z.array(MemoryItemSchema).default([]),
});

export type SessionLogEntry = z.infer<typeof SessionLogEntrySchema>;

/**
 * ExtractionSummary — the agent's top-level structured output.
 * `summary` is the session title used in the daily log heading.
 * `no_extract` short-circuits the workflow when nothing was worth recording.
 * `session_log` is OVERWRITTEN by deterministic post-run assembly from
 * `deps.session_*` collections (mirrors Python `_run_dream_extraction`
 * lines 591–602) — the LLM's own session_log is discarded.
 */
export const ExtractionSummarySchema = z.object({
  summary: z.string().default(''),
  no_extract: z.boolean().default(false),
  session_log: SessionLogEntrySchema,
});

export type ExtractionSummary = z.infer<typeof ExtractionSummarySchema>;

/**
 * Returns an empty SessionLogEntry — used by short-session no_extract path
 * and by the post-run assembly when the agent didn't call any store tools.
 */
export function emptySessionLog(): SessionLogEntry {
  return {
    context: '',
    key_exchanges: [],
    decisions_made: [],
    lessons_learned: [],
    failed_lessons: [],
    action_items: [],
    concepts: [],
    connections: [],
    memories: [],
  };
}
