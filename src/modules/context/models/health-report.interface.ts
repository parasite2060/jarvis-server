/**
 * Health report shape — Story 13.5 / Q9.
 *
 * Mirrors Python `app/services/dream_models.py :: HealthReport` (10 fields,
 * verified 2026-05-08). Only six of those fields drive `format_health_summary`
 * (`context_assembly.py:65-79`); the remaining four are part of the Pydantic
 * model and the Zod schema accepts them so a JSON.parse round-trip from the
 * embedded `health_report=...` payload validates cleanly.
 *
 * All array fields default to `[]`, booleans to `false`, integers to `0` —
 * matches Python `Field(default_factory=...)` defaults.
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
  total_issues: z.number().default(0),
});

export type HealthReport = z.infer<typeof HealthReportSchema>;
