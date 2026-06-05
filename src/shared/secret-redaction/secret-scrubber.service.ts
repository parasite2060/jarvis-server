import { Injectable } from '@nestjs/common';
import { FUNCTION_REGISTRY, PATTERNS } from './patterns';

/**
 * Server-side secret scrubber. Ports the logic from
 * `components/jarvis-server/app/services/secret_scrubber.py :: scrub()`.
 *
 * Mirrors the plugin-side redaction in
 * `components/jarvis-claude-plugin/hooks/lib/secret_scrubber.ts`
 * and the agent-prompt redaction rules to satisfy the three-layer defence
 * in `architecture.md §6.2`.
 *
 * Output shape `{ scrubbed, redactionCounts }` matches the Python helper.
 * Logging (when redactions occur) is the caller's responsibility
 * (see `IngestTranscriptUseCase` which owns the telemetry event).
 */
@Injectable()
export class SecretScrubberService {
  scrub(text: string): { scrubbed: string; redactionCounts: Record<string, number> } {
    if (!text) {
      return { scrubbed: text, redactionCounts: {} };
    }

    let scrubbed = text;
    const redactionCounts: Record<string, number> = {};

    for (const pattern of PATTERNS) {
      // Strip 'g' flag so matchAll / exec work predictably; re-add explicitly
      const rawFlags = pattern.flags.replace('g', '');
      const globalFlags = rawFlags + (rawFlags.includes('g') ? '' : 'g');
      const compiled = new RegExp(pattern.regex, globalFlags);

      const fn = pattern.replacementType === 'function' ? FUNCTION_REGISTRY[pattern.function!] : null;

      // Count matches by iterating BEFORE mutating scrubbed
      let matchCount = 0;
      if (fn) {
        // Function replacement: collect matches first, then apply
        const sticky = new RegExp(pattern.regex, globalFlags);
        const matches: RegExpMatchArray[] = [];
        let m: RegExpExecArray | null;
        while ((m = sticky.exec(scrubbed)) !== null) {
          matches.push(m);
        }
        matchCount = matches.length;
        for (const match of matches) {
          scrubbed = scrubbed.replace(match[0], fn(match));
        }
      } else {
        // Literal / backref: matchAll gives us count without mutating yet
        const sticky = new RegExp(pattern.regex, globalFlags);
        const matches = [...scrubbed.matchAll(sticky)];
        matchCount = matches.length;
        scrubbed = scrubbed.replace(compiled, pattern.replacement!);
      }

      if (matchCount > 0) {
        redactionCounts[pattern.name] = matchCount;
      }
    }

    return { scrubbed, redactionCounts };
  }
}
