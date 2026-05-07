/**
 * Presenter for `GET /memory/context` — Story 13.5 / N1.
 *
 * Snake_case TS property names directly per N1 / Q4 carry-forward — NO `@Expose`
 * overrides. Mirrors Python `ContextData` (`memory.py:29-34`). Plugin's
 * `getContext()` reads `envelope.data.context` only; `cached` and `assembled_at`
 * are not consumed by the plugin today but match Python's wire format for MC1.
 */
export class ContextPresenter {
  constructor(
    public readonly context: string,
    public readonly cached: boolean,
    public readonly assembled_at: string,
  ) {}
}
