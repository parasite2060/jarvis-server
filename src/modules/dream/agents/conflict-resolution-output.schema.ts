import { z } from 'zod';

/**
 * Structured output of the conflict-resolution agent. Azure strict mode:
 * every key required, `.nullable()` (never `.optional()`), no open maps.
 */
export const ConflictResolutionOutputSchema = z.object({
  resolvedContent: z.string(),
  reasoning: z.string(),
  confident: z.boolean(),
});

export type ConflictResolutionOutput = z.infer<typeof ConflictResolutionOutputSchema>;
