/**
 * Presenter for `GET /memory/context` — Story 13.5 / N1.
 *
 * Snake_case TS property names directly per N1 / Q4 carry-forward — NO `@Expose`
 * overrides. Mirrors Python `ContextData` (`memory.py:29-34`).
 *
 * Plugin's `getContext()` reads `envelope.data.context` only; `cached` and `assembled_at`
 * are not consumed by the plugin today but match Python's wire format for MC1.
 *
 * Structured keys (soul/identity/memory/recentDailys) added for TC-01-06 compliance.
 * `context` field retained for backward compat with existing plugin consumers.
 */
export class ContextPresenter {
  constructor(
    /**
     * Legacy markdown string — maintained for plugin backward compat.
     * Contains all present vault sections as `## <LABEL>\n\n<content>`.
     */
    public readonly context: string,
    public readonly cached: boolean,
    public readonly assembled_at: string,
    /**
     * Structured soul section (null if not present in vault).
     */
    public readonly soul: string | null,
    /**
     * Structured identity section (null if not present in vault).
     */
    public readonly identity: string | null,
    /**
     * Structured memory section (null if not present in vault).
     */
    public readonly memory: string | null,
    /**
     * Array of recent daily section contents (today + yesterday where present).
     */
    public readonly recentDailys: Array<{ label: string; content: string }>,
    /**
     * Structured decisions index section (null if not present in vault).
     */
    public readonly decisionsIndex: string | null,
    /**
     * Structured projects index section (null if not present in vault).
     */
    public readonly projectsIndex: string | null,
    /**
     * Structured patterns index section (null if not present in vault).
     */
    public readonly patternsIndex: string | null,
    /**
     * Structured templates index section (null if not present in vault).
     */
    public readonly templatesIndex: string | null,
  ) {}
}
