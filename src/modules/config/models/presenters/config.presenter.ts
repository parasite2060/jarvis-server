/**
 * ConfigPresenter — placeholder presenter (Story 13.10.5).
 * Story 13.13 fills the actual config-yml-to-API shape.
 */
export class ConfigPresenter {
  constructor(
    public readonly deepDreamCron: string,
    public readonly weeklyReviewCron: string,
    public readonly autoMerge: boolean,
  ) {}
}
