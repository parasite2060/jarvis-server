/**
 * Zod schema for the deep-dream Health Fix agent's structured output
 * (Story 13.11).
 *
 * Field-for-field port of `components/jarvis-server/app/services/dream_models.py`
 * (`HealthFixAction`, `HealthFixOutput`).
 *
 * # Q9 inherited Python intent (RESOLVED 2026-05-08): no `writeFile` tool
 *   The agent emits `HealthFixAction` records describing what *should* be
 *   done; it does NOT actually mutate vault files. The `write_file` mention
 *   was stripped from the TS port of `prompts/deep-dream-health-fix.md`.
 *   Vault writes flow through Phase 3's triple-collection (Q3).
 */
import { z } from 'zod';

export const HEALTH_FIX_ISSUE_TYPES = ['unresolved_contradiction', 'knowledge_gap', 'unclassified_lesson'] as const;
export const HEALTH_FIX_ACTION_TAKEN = ['resolved_contradiction', 'added_concept_note', 'classified_lesson', 'skipped'] as const;

export const HealthFixActionSchema = z.object({
  issue_type: z.enum(HEALTH_FIX_ISSUE_TYPES),
  target_file: z.string(),
  action_taken: z.enum(HEALTH_FIX_ACTION_TAKEN),
  reason: z.string().default(''),
});

export type HealthFixAction = z.infer<typeof HealthFixActionSchema>;

export const HealthFixOutputSchema = z.object({
  actions: z.array(HealthFixActionSchema).default([]),
  issues_resolved: z.number().int().nonnegative().default(0),
  issues_skipped: z.number().int().nonnegative().default(0),
  iteration: z.number().int().positive().default(1),
});

export type HealthFixOutput = z.infer<typeof HealthFixOutputSchema>;
