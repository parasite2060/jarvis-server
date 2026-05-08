# Weekly-Review Byte-Equivalence Fixtures (Story 13.12)

Per **Story 13.12 / Q7 RESOLVED 2026-05-08 by team-lead**: byte-equivalence
fixture recording is **DEFERRED to Story 13.12.1** (same precedent as
13.10.1 and 13.11.1).

## Status

- **Recording deferred** — homelab DB access (`192.168.50.203:5432`) and
  vault git-history snapshot (at SHA `61116c7`) are required to capture a
  reference Python run end-to-end.
- **Activity tree + workflow + agent + Zod schema + ISO-week helper +
  integration tests all SHIPPED** in Story 13.12 with mocked
  `DeepAgentFactory`. The byte-equivalence test is the only artifact
  pending.

## Recording procedure (for Story 13.12.1)

Mirror the 13.11 fixture-recording procedure documented in
`test/fixtures/deep-dreams/README.md`. The weekly-review fixture set is
SIMPLER than deep-dream's because there's only ONE LLM phase.

### Per recorded week (`seed-N/`)

1. **`vault-state.tar.gz`** — full vault snapshot at the start of the
   weekly-review run. MUST include 7 dailys for the recorded week (Monday
   through Sunday) and the 6 vault-folder `_index.md` files plus
   `_guide.md`. Use `tar -czf vault-state.tar.gz -C ~/ai-memory .` from
   a clean checkout at the recording SHA.
2. **`expected-review.md`** — the produced `reviews/YYYY-Www.md` content
   WITH frontmatter prepended. Capture from Python's `write_review_file`
   output (read the file from disk after the Python run, before any git
   reset).
3. **`expected-frontmatter.json`** — parsed frontmatter for explicit
   assertion (avoids YAML-vs-string drift).
4. **`expected-pr-body.md`** — the Python `commit_and_pr` PR body (NOT
   commit message). Format mirrors:
   ```
   ## Weekly Review

   **Dream ID:** {dream_id}
   **Week:** {week_iso}

   ### Changed Files
   - `reviews/YYYY-Www.md`
   ```
5. **`recording-metadata.json`**:
   ```json
   {
     "week_start": "2026-05-04",
     "dream_id": 42,
     "week_iso": "2026-W19",
     "python_jarvis_server_sha": "61116c7",
     "recorded_at": "2026-05-XX",
     "fake_llm_responses": "see fake_llm_responses.json"
   }
   ```
6. **`fake_llm_responses.json`** — the SINGLE LLM response captured during
   recording. Used by `FakeListChatModel` during replay so byte-equivalence
   doesn't depend on llama.cpp determinism.

### Replay spec

When fixtures are recorded, create
`test/temporal/weekly-review.byte-equivalence.spec.ts` with:

1. Restore `vault-state.tar.gz` to a temp dir; point `VAULT_PATH` env at it.
2. Configure `DeepAgentFactory` to inject `FakeListChatModel` seeded with
   `fake_llm_responses.json`.
3. Run `weeklyReviewWorkflow` against `TestWorkflowEnvironment.createLocal()`.
4. Mock `GitOpsService.createPullRequest(...)` to return a fake PR URL;
   capture the `body` argument for byte-equivalent comparison with
   `expected-pr-body.md`.
5. Assert `reviews/${week_iso}.md` content matches `expected-review.md`
   byte-for-byte (modulo `created` frontmatter date if it varies — the
   `created` value is the Monday ISO date, which IS deterministic from
   `week_start`).

### Recording prerequisites

- Homelab connectivity verified: `psql postgresql://jarvis:***@192.168.50.203:5432/jarvis -c "SELECT 1"`.
- llama.cpp running locally at `http://0.0.0.0:8080/v1` (set
  `LLM_PROVIDER=llamacpp` for the recording session).
- Python jarvis-server checked out at SHA `61116c7` and able to run a
  weekly-review Temporal workflow against the homelab DB.
- Clone of `~/ai-memory/` with the recording-week's git history present.

### Same-deferral cohort

Stories 13.10.1, 13.11.1, and 13.12.1 share the homelab-access blocker and
will land together when access is unblocked. The fixture-recording tooling
(`tools/record-byte-equivalence-fixtures.ts`) is intended to be reused
across all three pipelines (light / deep / weekly).
