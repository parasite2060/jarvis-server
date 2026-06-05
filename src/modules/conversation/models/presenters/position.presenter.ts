/**
 * GET /conversations/position presenter — snake_case wire format.
 *
 * Python `app/api/routes/conversations.py:42` returns a raw dict
 * `{"session_id": ..., "last_line": ...}` (NOT a Pydantic model — no alias
 * generation applies). The Claude-Code plugin's `fetchLastPosition` reads
 * `body.last_line` AT THE TOP LEVEL — so MC1 byte-equivalence requires:
 *
 *   1. snake_case property names (`session_id`, `last_line`)
 *   2. NO `HttpApiResponse.success` wrapping for THIS endpoint (the plugin
 *      reads `body.last_line`, not `body.data.last_line`)
 *
 * The controller therefore returns `PositionPresenter` directly for the GET
 * position route — see `conversation.controller.ts` header.
 */
export class PositionPresenter {
  session_id: string;
  last_line: number;

  constructor(sessionId: string, lastLine: number) {
    this.session_id = sessionId;
    this.last_line = lastLine;
  }
}
