/**
 * TriggerLightDreamCommand — cross-module CommandBus entry point
 * (Story 13.10.5 / Q2 RESOLVED 2026-05-08 by TanNT — module-map §1 wins
 * over §A.4 sign-off block).
 *
 * Per TanNT's "follow §1 exactly" ruling: the conversation module no longer
 * injects `TemporalClientService` directly to dispatch light-dream — it
 * dispatches this command via `CommandBus.execute(...)`. The handler in
 * `dream/commands/handlers/trigger-light-dream.handler.ts` calls the
 * temporal client.
 *
 * Trade-off vs §A.4: extra in-process hop, but enforces the module-map §1
 * "all cross-module work via Command/Event" principle (architecture.md §1.4
 * principle 8) — no special-case for trigger paths.
 */

export class TriggerLightDreamCommand {
  constructor(public readonly payload: { sessionId: string; transcriptId: number }) {}
}
