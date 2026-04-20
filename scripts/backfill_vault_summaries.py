"""One-shot idempotent backfill for vault-file `summary:` frontmatter (Story 11.14).

Walks every `*.md` file under the managed vault folders. Skips any file that
already has a `summary:` field in its frontmatter. For files without one,
asks the LLM for a short one-line summary (≤100 chars, no markdown) given
the file's title + first 500 chars of body, and rewrites the file with the
new `summary:` field inserted into the existing frontmatter block.

Idempotent by construction — re-running produces no writes once every file
has a summary.

**Manual invocation only.** Pause the ARQ worker before running to avoid
racing with dream writes:

```bash
uv run python -m scripts.backfill_vault_summaries
```

See `scripts/README.md` for operator notes.
"""

from __future__ import annotations

import asyncio
import re
import sys
from dataclasses import dataclass
from pathlib import Path

from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

from app.config import settings
from app.services.vault_updater import (
    VAULT_FOLDERS,
    _extract_frontmatter_block,
    _extract_frontmatter_summary,
    _extract_title,
)

SUMMARY_BODY_SAMPLE = 500

SYSTEM_PROMPT = (
    "You write one-line summaries of knowledge-vault files. "
    "Given a file's title and a short body sample, produce a summary "
    "that describes what the file IS (not what's in it). "
    "Constraints: single line, at most 100 characters, no markdown syntax, "
    "no leading bullet, no trailing period. Return ONLY the summary text."
)


@dataclass
class BackfillResult:
    """Summary of one backfill run — useful for tests and the CLI output."""

    scanned: int = 0
    skipped: int = 0
    updated: int = 0
    failed: int = 0
    modified_paths: list[str] | None = None

    def __post_init__(self) -> None:
        if self.modified_paths is None:
            self.modified_paths = []


def _build_agent() -> Agent[None, str]:
    """Build a simple text-output PydanticAI agent for summary generation."""
    provider = OpenAIProvider(
        base_url=settings.llm_base_url or settings.llm_endpoint,
        api_key=settings.llm_api_key,
    )
    model = OpenAIChatModel(settings.llm_model, provider=provider)
    return Agent(model, output_type=str, instructions=SYSTEM_PROMPT)


def _sample_body(content: str) -> str:
    """Return the first SUMMARY_BODY_SAMPLE chars of the body (post-frontmatter)."""
    body_match = re.match(r"^---\n.*?\n---\n(.*)", content, re.DOTALL)
    body = body_match.group(1) if body_match else content
    return body.strip()[:SUMMARY_BODY_SAMPLE]


def _insert_summary_into_frontmatter(content: str, summary: str) -> str:
    """Insert `summary: "<value>"` into the existing frontmatter block.

    Assumes content has a leading `---\n...\n---\n` block. Replaces that block
    with the same block plus a `summary:` line appended (before the closing
    `---`). Escapes `\\` and `"` in the summary value.
    """
    m = re.match(r"^(---\n)(.*?)(\n---\n)", content, re.DOTALL)
    if m is None:
        raise ValueError("No frontmatter block found")
    escaped = summary.replace("\\", "\\\\").replace('"', '\\"')
    new_block = m.group(1) + m.group(2) + f'\nsummary: "{escaped}"' + m.group(3)
    return new_block + content[m.end() :]


async def _generate_summary(agent: Agent[None, str], title: str, body_sample: str) -> str:
    """Call the LLM and return a single-line ≤100-char summary."""
    prompt = f"Title: {title}\n\nBody sample:\n{body_sample}"
    result = await agent.run(prompt)
    summary = str(result.output).strip().splitlines()[0].strip()
    # Defensive truncation — model should respect the 100-char rule but don't trust.
    if len(summary) > 100:
        summary = summary[:97] + "..."
    return summary


async def _backfill_file(
    agent: Agent[None, str] | None,
    file_path: Path,
    result: BackfillResult,
    *,
    dry_run: bool,
    summary_override: str | None = None,
) -> None:
    """Process one file: skip, or generate + insert summary, or fail.

    `summary_override` bypasses the LLM call — used by tests to avoid hitting
    a real model. Production runs leave it at None.
    """
    result.scanned += 1
    content = file_path.read_text(encoding="utf-8")

    if _extract_frontmatter_summary(content):
        result.skipped += 1
        return

    if _extract_frontmatter_block(content) is None:
        # File lacks frontmatter entirely — out of scope (Story 11.11 handles
        # missing_frontmatter during dream cycles; the backfill is strictly
        # additive to existing frontmatter blocks).
        result.skipped += 1
        return

    title = _extract_title(content) or file_path.stem.replace("-", " ").title()
    body_sample = _sample_body(content)

    try:
        if summary_override is not None:
            summary = summary_override
        else:
            if agent is None:
                raise RuntimeError("agent must be provided when summary_override is None")
            summary = await _generate_summary(agent, title, body_sample)
    except Exception as exc:
        result.failed += 1
        print(f"FAIL {file_path}: {exc}", file=sys.stderr)
        return

    new_content = _insert_summary_into_frontmatter(content, summary)

    if dry_run:
        print(f"DRY {file_path}: would insert summary='{summary}'")
        return

    file_path.write_text(new_content, encoding="utf-8")
    result.updated += 1
    assert result.modified_paths is not None
    result.modified_paths.append(str(file_path))
    print(f"UPDATED {file_path}: summary='{summary}'")


async def backfill(
    vault_root: Path | None = None,
    *,
    dry_run: bool = False,
    summary_override: str | None = None,
    folders: tuple[str, ...] = VAULT_FOLDERS,
) -> BackfillResult:
    """Walk managed vault folders and backfill missing `summary:` frontmatter.

    Parameters
    ----------
    vault_root
        Vault root directory. Defaults to `settings.jarvis_memory_path`.
    dry_run
        If True, log intended writes without modifying files.
    summary_override
        Test hook. When non-None, bypasses the LLM and uses this value for
        every generated summary. Production runs must leave at None.
    folders
        Folder names to scan. Defaults to VAULT_FOLDERS (decisions, patterns,
        projects, concepts, connections, lessons, references, templates,
        topics).
    """
    root = vault_root or Path(settings.jarvis_memory_path)
    agent: Agent[None, str] | None = None
    if summary_override is None:
        agent = _build_agent()

    result = BackfillResult()

    for folder in folders:
        folder_path = root / folder
        if not folder_path.is_dir():
            continue
        for md_file in sorted(folder_path.glob("*.md")):
            if md_file.name == "_index.md":
                continue
            await _backfill_file(
                agent,
                md_file,
                result,
                dry_run=dry_run,
                summary_override=summary_override,
            )

    return result


def _format_report(result: BackfillResult) -> str:
    return (
        f"Scanned: {result.scanned} | "
        f"Skipped (already have summary or no frontmatter): {result.skipped} | "
        f"Updated: {result.updated} | "
        f"Failed: {result.failed}"
    )


async def _main() -> int:
    result = await backfill()
    print()
    print(_format_report(result))
    return 0 if result.failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
