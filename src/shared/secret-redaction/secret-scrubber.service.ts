import { Injectable } from '@nestjs/common';

/**
 * Pass-through stub for the secret-redaction defence layer (Story 13.3 / Q1).
 *
 * Story 13.15 retrofits this with the real versioned regex catalogue (matches
 * the plugin-side scrubber and the agent-prompt redaction rules to satisfy the
 * three-layer defence in `architecture.md §6.2`). For 13.3 the service exists
 * only so business modules can inject it now and 13.15 can swap in the real
 * implementation without further wiring changes.
 *
 * Output shape `{ scrubbed, redactionCounts }` matches the Python helper at
 * `components/jarvis-server/app/services/secret_scrubber.py :: scrub`.
 */
@Injectable()
export class SecretScrubberService {
  scrub(text: string): { scrubbed: string; redactionCounts: Record<string, number> } {
    return { scrubbed: text, redactionCounts: {} };
  }
}
