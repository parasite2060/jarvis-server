/**
 * DreamPresenter — placeholder presenter (Story 13.10.5).
 * Story 13.14 fills the actual GET /dream/{id} shape if needed.
 */
export class DreamPresenter {
  constructor(
    public readonly id: number,
    public readonly kind: string,
    public readonly outcome: string,
    public readonly prUrl: string | null,
  ) {}
}
