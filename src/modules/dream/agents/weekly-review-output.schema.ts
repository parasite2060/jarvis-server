/**
 * Zod schema for the weekly-review agent's structured output (Story 13.12).
 *
 * Field-for-field port of `components/jarvis-server/app/services/dream_models.py:169-173`
 * `WeeklyReviewOutput`:
 *   ```python
 *   class WeeklyReviewOutput(BaseModel):
 *       review_content: str = ""
 *       week_themes: list[str] = Field(default_factory=list)
 *       stale_action_items: list[str] = Field(default_factory=list)
 *       project_updates: dict[str, str] = Field(default_factory=dict)
 *   ```
 *
 * # Q8 binding (RESOLVED 2026-05-08, inherited from 13.10): snake_case keys
 *   The schema uses snake_case property names to preserve byte-equivalence
 *   with Python's `Pydantic.model_dump()` JSONB output stored in
 *   `dream_phases.output_json`. MC5 (output byte-equivalence) is
 *   non-negotiable.
 *
 * # Flat schema, no sub-models
 *   Mirrors Python — 4 top-level fields. `project_updates` is a free-form
 *   string-keyed string map (e.g., `{ "TaskFlow": "auth flow shipped" }`).
 */
import { z } from 'zod';

export const WeeklyReviewOutputSchema = z.object({
  review_content: z.string().default(''),
  week_themes: z.array(z.string()).default([]),
  stale_action_items: z.array(z.string()).default([]),
  project_updates: z.record(z.string(), z.string()).default({}),
});

export type WeeklyReviewOutput = z.infer<typeof WeeklyReviewOutputSchema>;
