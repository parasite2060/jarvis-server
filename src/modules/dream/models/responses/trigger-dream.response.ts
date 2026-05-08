/**
 * TriggerDreamResponse — POST /dream response shape (Story 13.10.5
 * placeholder; Story 13.14 fills functional fields).
 */
export class TriggerDreamResponse {
  constructor(
    public readonly accepted: boolean,
    public readonly dreamKind: string,
  ) {}
}
