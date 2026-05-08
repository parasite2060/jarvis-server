/**
 * Zod schemas for the deep-dream Phase 2 (REM Sleep) agent's structured
 * output (Story 13.11).
 *
 * Field-for-field port of `components/jarvis-server/app/services/dream_models.py`
 * (`Theme`, `ConnectionCandidate`, `PromotionCandidate`, `KnowledgeGap`,
 * `REMSleepOutput`). snake_case keys per Q8 from 13.10.
 *
 * `ALLOWED_RELATIONSHIP_TYPES` mirrors Python `dream_models.py:18-26`. Phase 2
 * connections must use one of these literal values.
 */
import { z } from 'zod';

/** Mirrors Python `ALLOWED_RELATIONSHIP_TYPES` tuple. */
export const ALLOWED_RELATIONSHIP_TYPES = [
  'extends',
  'contradicts',
  'supports',
  'inspired_by',
  'supersedes',
  'derived_from',
  'addresses_gap',
] as const;

export const RelationshipTypeSchema = z.enum(ALLOWED_RELATIONSHIP_TYPES);
export type RelationshipType = z.infer<typeof RelationshipTypeSchema>;

export const ThemeSchema = z.object({
  topic: z.string(),
  session_count: z.number().int().nonnegative().default(0),
  evidence: z.array(z.string()).default([]),
});

export type Theme = z.infer<typeof ThemeSchema>;

/**
 * Note: Python's `relationship_type` is a free-form `str` defaulting to
 * `'supports'`. The TS port keeps the Pydantic flexibility (any string)
 * but unit-test assertions can still verify allowed values via the
 * `ALLOWED_RELATIONSHIP_TYPES` constant. This preserves byte-equivalence
 * if Phase 2 ever emits a non-canonical type string (the LLM might).
 */
export const ConnectionCandidateSchema = z.object({
  concept_a: z.string(),
  concept_b: z.string(),
  relationship: z.string(),
  relationship_type: z.string().default('supports'),
  evidence_sessions: z.array(z.string()).default([]),
});

export type ConnectionCandidate = z.infer<typeof ConnectionCandidateSchema>;

export const PromotionCandidateSchema = z.object({
  source_file: z.string(),
  target_folder: z.string(),
  reason: z.string(),
});

export type PromotionCandidate = z.infer<typeof PromotionCandidateSchema>;

export const KnowledgeGapSchema = z.object({
  concept: z.string(),
  mentioned_in_files: z.array(z.string()).default([]),
});

export type KnowledgeGap = z.infer<typeof KnowledgeGapSchema>;

export const REMSleepOutputSchema = z.object({
  themes: z.array(ThemeSchema).default([]),
  new_connections: z.array(ConnectionCandidateSchema).default([]),
  promotion_candidates: z.array(PromotionCandidateSchema).default([]),
  gaps: z.array(KnowledgeGapSchema).default([]),
});

export type REMSleepOutput = z.infer<typeof REMSleepOutputSchema>;
