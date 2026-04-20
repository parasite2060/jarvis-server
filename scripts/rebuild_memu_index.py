"""One-shot idempotent rebuild of the MemU embedding index (Story 11.17).

Walks every `*.md` file under the managed vault folders and submits each one
to memu-server's `/memorize` endpoint as a two-message conversation (system:
file path, user: full content). The memu-worker Temporal worker then embeds
each file into the pgvector store so that `memu_search` returns results again.

This script is safe to re-run — MemU's memorize endpoint is upsert-based; any
file already indexed will be refreshed rather than duplicated.

**Pre-conditions:** The full stack must be running (jarvis-server, memu-server,
memu-worker, temporal, postgres). Pause the ARQ worker while running to avoid
racing with concurrent dream writes:

```bash
# From the components/jarvis-server/ root, with the same .env as the server:
docker compose stop jarvis-worker
uv run python -m scripts.rebuild_memu_index
docker compose start jarvis-worker
```

See `scripts/README.md` for operator notes.
"""

from __future__ import annotations

import asyncio
import sys
from dataclasses import dataclass, field
from pathlib import Path

from app.config import settings
from app.services.memu_client import memu_memorize
from app.services.vault_updater import VAULT_FOLDERS

CONCURRENCY = 5  # parallel memorize calls (Temporal / pgvector can absorb more; stay conservative)


@dataclass
class RebuildResult:
    """Summary of one rebuild run."""

    scanned: int = 0
    submitted: int = 0
    failed: int = 0
    failed_paths: list[str] = field(default_factory=list)


async def _submit_file(
    file_path: Path,
    result: RebuildResult,
    semaphore: asyncio.Semaphore,
) -> None:
    result.scanned += 1
    content = file_path.read_text(encoding="utf-8")
    messages = [
        {"role": "system", "content": str(file_path)},
        {"role": "user", "content": content},
    ]
    async with semaphore:
        try:
            await memu_memorize(messages, user_id="jarvis", agent_id="rebuild")
            result.submitted += 1
            print(f"SUBMITTED {file_path}")
        except Exception as exc:
            result.failed += 1
            result.failed_paths.append(str(file_path))
            print(f"FAIL {file_path}: {exc}", file=sys.stderr)


async def rebuild(
    vault_root: Path | None = None,
    *,
    folders: tuple[str, ...] = VAULT_FOLDERS,
) -> RebuildResult:
    """Submit all vault markdown files to memu-server for re-indexing."""
    root = vault_root or Path(settings.jarvis_memory_path)
    result = RebuildResult()
    semaphore = asyncio.Semaphore(CONCURRENCY)
    tasks: list[asyncio.Task[None]] = []

    for folder in folders:
        folder_path = root / folder
        if not folder_path.is_dir():
            continue
        for md_file in sorted(folder_path.glob("*.md")):
            tasks.append(asyncio.create_task(_submit_file(md_file, result, semaphore)))

    await asyncio.gather(*tasks)
    return result


def _format_report(result: RebuildResult) -> str:
    lines = [f"Scanned: {result.scanned} | Submitted: {result.submitted} | Failed: {result.failed}"]
    if result.failed_paths:
        lines.append("Failed files:")
        lines.extend(f"  {p}" for p in result.failed_paths)
    return "\n".join(lines)


async def _main() -> int:
    result = await rebuild()
    print()
    print(_format_report(result))
    return 0 if result.failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
