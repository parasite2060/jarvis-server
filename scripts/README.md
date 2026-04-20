# Operational scripts

One-shot maintenance utilities that run **outside** the normal server / ARQ
worker lifecycle. Do NOT wire any of these into `docker compose up` or the
ARQ task queue — they are manual operator tools.

## backfill_vault_summaries.py

Run manually once after Story 11.14 ships. Pause the ARQ worker first (so
no dream races with the backfill's writes). Script is idempotent — safe to
re-run; files that already have `summary:` in frontmatter are skipped.

```bash
# From the components/jarvis-server/ root, with the same .env as the server:
docker compose stop arq-worker    # or `systemctl stop jarvis-worker`
uv run python -m scripts.backfill_vault_summaries
docker compose start arq-worker
```

The script walks every `*.md` file under the managed vault folders
(decisions/, patterns/, projects/, concepts/, connections/, lessons/,
references/, templates/, topics/), skips files with existing `summary:`
frontmatter, and asks the LLM for a ≤100-char single-line summary given
the file's title + first 500 chars of body. The new `summary:` field is
inserted into the existing frontmatter block, preserving every other
field exactly as-is.

Each modified file is logged with a one-line diff summary to stdout for
operator review. The script does not commit git changes — review the
working tree after the run and commit manually.

## rebuild_memu_index.py

Run manually after first deploying the `memu-worker` service (Story 11.17)
to backfill all vault files into the MemU embedding index. Also useful after
any MemU data loss or suspected index corruption.

**Pre-conditions:** The full stack must be running including the new
`memu-worker` container. Pause the ARQ worker to avoid racing with dream
writes:

```bash
# From the components/jarvis-server/ root, with the same .env as the server:
docker compose stop jarvis-worker
uv run python -m scripts.rebuild_memu_index
docker compose start jarvis-worker
```

The script walks every `*.md` file under the managed vault folders and
submits each to memu-server's `/memorize` endpoint. The memu-worker Temporal
worker picks up each task and embeds it into the pgvector store. The script
is idempotent — MemU upserts on re-submission, so re-running is safe.

Progress is logged to stdout (`SUBMITTED <path>`). Failures are logged to
stderr and summarised at the end. The script exits non-zero if any file
failed.
