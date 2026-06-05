/**
 * Zod schemas for the deep-dream Phase 3 (Deep Sleep / Consolidation) agent's
 * structured output (Story 13.11).
 *
 * Field-for-field port of `components/jarvis-server/app/services/dream_models.py`
 * (`ConsolidationStats`, `VaultFileEntry`, `VaultUpdates`, `ConsolidationOutput`).
 *
 * # Q3 deviation (RESOLVED 2026-05-08): triple-collection
 *   The Python schema does not include `vault_writes`. The TS port adds it
 *   so that `commitAndPr` can write vault files on the new branch — fixes
 *   Python's working-tree-fragility bug (mirrors 13.10's Q12 deviation).
 *   The field is OPTIONAL with default []; Phase 3's LLM does NOT populate
 *   it (the agent's prompt is unchanged from Python). Instead, the
 *   `writeFiles` activity computes the triples from `vault_updates` (modulo
 *   Q10 topics-drop) and assigns them BEFORE handoff to `commitAndPr`.
 *
 * # Q10 inherited Python bug (RESOLVED 2026-05-08): topics drop
 *   `vault_updates.topics` is INTENTIONALLY KEPT in the schema (Phase 3
 *   may emit topics writes; preserving emission preserves byte-equivalence
 *   of `dream_phases.output_json`). The drop happens at the activity
 *   boundary in `writeFiles` per Q14 — `delete vault_updates.topics`
 *   before iterating folders. Documented in Dev Notes; flagged for retro
 *   fix in Story 13.18.
 */
import { z } from 'zod';

export const ConsolidationStatsSchema = z.object({
  total_memories_processed: z.number().int().nonnegative().default(0),
  duplicates_removed: z.number().int().nonnegative().default(0),
  contradictions_resolved: z.number().int().nonnegative().default(0),
  patterns_promoted: z.number().int().nonnegative().default(0),
  stale_pruned: z.number().int().nonnegative().default(0),
});

export type ConsolidationStats = z.infer<typeof ConsolidationStatsSchema>;

export const VaultFileActionSchema = z.enum(['create', 'update']);
export type VaultFileEntryAction = z.infer<typeof VaultFileActionSchema>;

/**
 * VaultFileEntry — Python `dream_models.VaultFileEntry`. `summary` is capped
 * at 100 characters by Python (`Field(max_length=100)`); we mirror via Zod
 * `.max(100)`. Phase 3's prompt instructs the LLM to keep summary < 100.
 */
export const VaultFileEntrySchema = z.object({
  filename: z.string(),
  title: z.string(),
  summary: z.string().max(100),
  content: z.string(),
  tags: z.array(z.string()).default([]),
  action: VaultFileActionSchema,
});

export type VaultFileEntry = z.infer<typeof VaultFileEntrySchema>;

/**
 * VaultUpdates — 8-folder bucket. `topics` is preserved in the schema for
 * Python emission parity but dropped at the activity boundary per Q10/Q14.
 */
export const VaultUpdatesSchema = z.object({
  decisions: z.array(VaultFileEntrySchema).default([]),
  projects: z.array(VaultFileEntrySchema).default([]),
  patterns: z.array(VaultFileEntrySchema).default([]),
  templates: z.array(VaultFileEntrySchema).default([]),
  concepts: z.array(VaultFileEntrySchema).default([]),
  connections: z.array(VaultFileEntrySchema).default([]),
  lessons: z.array(VaultFileEntrySchema).default([]),
  topics: z.array(VaultFileEntrySchema).default([]),
});

export type VaultUpdates = z.infer<typeof VaultUpdatesSchema>;

/**
 * VaultWriteTriple — Q3 deviation field. Each triple is one
 * `(path, content, action)` entry the `commitAndPr` activity writes on the
 * new branch via `gitOps.writeFiles(...)`. Mirrors 13.10's
 * `RecordWriteTriple` shape (Q12 deviation).
 */
export const VaultWriteTripleSchema = z.object({
  path: z.string(),
  content: z.string(),
  action: z.enum(['create', 'update']),
});

export type VaultWriteTriple = z.infer<typeof VaultWriteTripleSchema>;

/**
 * ConsolidationOutput — Phase 3 LLM output.
 *
 * `vault_writes` is the Q3-deviation field that carries the triples
 * `commitAndPr` consumes. Phase 3's LLM does NOT populate it; the
 * `writeFiles` activity flattens `vault_updates` into triples after the
 * topics-drop and writes them onto `consolidation.vault_writes`.
 */
export const ConsolidationOutputSchema = z.object({
  memory_md: z.string(),
  daily_summary: z.string(),
  stats: ConsolidationStatsSchema.default({
    total_memories_processed: 0,
    duplicates_removed: 0,
    contradictions_resolved: 0,
    patterns_promoted: 0,
    stale_pruned: 0,
  }),
  vault_updates: VaultUpdatesSchema.default({
    decisions: [],
    projects: [],
    patterns: [],
    templates: [],
    concepts: [],
    connections: [],
    lessons: [],
    topics: [],
  }),
  /** Q3 deviation — populated by `writeFiles`, not the LLM. */
  vault_writes: z.array(VaultWriteTripleSchema).default([]),
});

export type ConsolidationOutput = z.infer<typeof ConsolidationOutputSchema>;
