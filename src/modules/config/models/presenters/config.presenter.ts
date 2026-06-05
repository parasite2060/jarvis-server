/**
 * ConfigPresenter — vault `config.yml` shape exposed via `GET /config` and
 * the body of `PATCH /config` 200 response. Camel-case wire format per MC1
 * + Story 13.6 Q1.
 *
 * Mirrors Python `ConfigData` (`app/models/config_schemas.py:12-18`).
 *
 * Story 13.13 — `weeklyReviewCron` IS included (Python bug #2 fixed; see
 * Dev Notes §I in story 13.13).
 */
export class ConfigPresenter {
  constructor(
    public readonly autoMerge: boolean,
    public readonly deepDreamCron: string,
    public readonly weeklyReviewCron: string,
    public readonly maxMemoryLines: number,
  ) {}
}
