/**
 * Zod schema for the deep-dream health-check structured output (Story 13.11).
 *
 * Field-for-field port of `components/jarvis-server/app/services/dream_models.py`
 * (`HealthReport`). 9 issue types — Python `services/deep_dream.py:433-595`.
 *
 * Note: `health_check.py` is DETERMINISTIC Python code (NOT an LLM call).
 * This schema is used to validate the activity's output and to round-trip
 * the report into Health Fix's input dict.
 */
import { z } from 'zod';

export const HealthReportSchema = z.object({
  orphan_notes: z.array(z.string()).default([]),
  stale_notes: z.array(z.string()).default([]),
  missing_frontmatter: z.array(z.string()).default([]),
  unresolved_contradictions: z.array(z.string()).default([]),
  memory_overflow: z.boolean().default(false),
  knowledge_gaps: z.array(z.string()).default([]),
  missing_backlinks: z.array(z.string()).default([]),
  unclassified_lessons: z.array(z.string()).default([]),
  broken_wikilinks: z.array(z.string()).default([]),
  total_issues: z.number().int().nonnegative().default(0),
});

export type HealthReport = z.infer<typeof HealthReportSchema>;
