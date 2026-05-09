/**
 * TriggerDreamPresenter — POST /dream success body.
 * Mirrors Python `dream.py:55` payload `{ status: 'queued' }`.
 * Wrapped via `HttpApiResponse.success(presenter)` at controller layer to
 * produce byte-equivalent `{ data: { status: 'queued' }, status: 'ok' }`.
 */
export class TriggerDreamPresenter {
  constructor(public readonly status: string) {}
}
