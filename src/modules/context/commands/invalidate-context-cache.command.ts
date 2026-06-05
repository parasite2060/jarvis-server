/**
 * Cross-module InvalidateContextCacheCommand — Story 13.5 / Q6.
 *
 * Owned by `context`; future callers (light/deep/weekly dream activities in
 * Stories 13.10 / 13.11 / 13.12) dispatch via `CommandBus`. Story 13.5 ships
 * the command + handler + tests; no callers in this story.
 *
 * `reason` is a kebab-case literal union per leader resolution Q6 (binding —
 * NOT the camelCase `'lightDream'` form sketched in module-map §5.2.2 originally).
 * `timestamp` is a Date so callers can pass `new Date()` directly; the handler
 * formats it via `formatPythonIso()` for consistent log output.
 */
export type InvalidateContextCacheReason =
  | 'light-dream-completed'
  | 'deep-dream-completed'
  | 'weekly-review-completed'
  | 'manual'
  | 'periodic-vault-sync';

export class InvalidateContextCacheCommand {
  constructor(public readonly payload: { reason: InvalidateContextCacheReason; timestamp: Date }) {}
}
