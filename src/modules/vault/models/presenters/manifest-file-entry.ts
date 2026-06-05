/**
 * Per-file manifest entry presenter — Story 13.6 / Q1 binding.
 *
 * camelCase wire format directly per Q1 (Pydantic v2 + FastAPI default
 * serializes by alias). Plugin reads `f.path` / `f.hash` / `f.size` /
 * `f.updatedAt` (verified at `worker/file-sync.js:116-119` +
 * `hooks/lib/jarvis-client.js:88`). NO `@Expose` overrides.
 */
export class ManifestFileEntry {
  constructor(
    public readonly path: string,
    public readonly hash: string,
    public readonly size: number,
    public readonly updatedAt: string,
  ) {}
}
