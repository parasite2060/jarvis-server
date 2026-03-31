from datetime import date
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

SAMPLE_MEMU_MEMORIES: list[dict[str, Any]] = [
    {"content": "Use FastAPI because async-first", "type": "decision"},
    {"content": "Prefer httpx over requests", "type": "preference"},
]

SAMPLE_MEMORY_MD = """---
type: memory
tags: [memory, index]
created: 2026-03-01
updated: 2026-03-30
last_reviewed: 2026-03-30
---

# Memory Index

## Strong Patterns
- Always READ before WRITE for memory files (5x)

## Decisions
- Use FastAPI because async-first (2026-03-01)

## Facts
- Project uses PostgreSQL with pgvector

## Recent
- Added structured logging with structlog (2026-03-29)
"""

SAMPLE_DAILY_LOG = """---
type: daily
date: 2026-03-31
---

## Session 1
Discussed architecture decisions for dream pipeline.
"""

SAMPLE_SOUL_MD = "# Soul\nPrinciples and philosophy."


@pytest.mark.asyncio
async def test_gather_returns_all_vault_files_and_memu() -> None:
    mock_memu = AsyncMock(return_value={"memories": SAMPLE_MEMU_MEMORIES})
    mock_read = AsyncMock(side_effect=[SAMPLE_MEMORY_MD, SAMPLE_DAILY_LOG, SAMPLE_SOUL_MD])

    with (
        patch("app.services.deep_dream.memu_retrieve", mock_memu),
        patch("app.services.deep_dream.read_vault_file", mock_read),
    ):
        from app.services.deep_dream import gather_consolidation_inputs

        result = await gather_consolidation_inputs(date(2026, 3, 31))

    assert result is not None
    assert result["memu_memories"] == SAMPLE_MEMU_MEMORIES
    assert result["memory_md"] == SAMPLE_MEMORY_MD
    assert result["daily_log"] == SAMPLE_DAILY_LOG
    assert result["soul_md"] == SAMPLE_SOUL_MD
    mock_memu.assert_called_once_with(query="memories from 2026-03-31", method="rag")


@pytest.mark.asyncio
async def test_gather_returns_none_when_memu_empty() -> None:
    mock_memu = AsyncMock(return_value={"memories": []})

    with patch("app.services.deep_dream.memu_retrieve", mock_memu):
        from app.services.deep_dream import gather_consolidation_inputs

        result = await gather_consolidation_inputs(date(2026, 3, 31))

    assert result is None


@pytest.mark.asyncio
async def test_gather_returns_none_when_memu_no_memories_key() -> None:
    mock_memu = AsyncMock(return_value={})

    with patch("app.services.deep_dream.memu_retrieve", mock_memu):
        from app.services.deep_dream import gather_consolidation_inputs

        result = await gather_consolidation_inputs(date(2026, 3, 31))

    assert result is None


@pytest.mark.asyncio
async def test_gather_handles_missing_memory_md() -> None:
    mock_memu = AsyncMock(return_value={"memories": SAMPLE_MEMU_MEMORIES})
    mock_read = AsyncMock(side_effect=[None, SAMPLE_DAILY_LOG, SAMPLE_SOUL_MD])

    with (
        patch("app.services.deep_dream.memu_retrieve", mock_memu),
        patch("app.services.deep_dream.read_vault_file", mock_read),
    ):
        from app.services.deep_dream import gather_consolidation_inputs

        result = await gather_consolidation_inputs(date(2026, 3, 31))

    assert result is not None
    assert result["memory_md"] == ""


@pytest.mark.asyncio
async def test_gather_handles_missing_daily_log() -> None:
    mock_memu = AsyncMock(return_value={"memories": SAMPLE_MEMU_MEMORIES})
    mock_read = AsyncMock(side_effect=[SAMPLE_MEMORY_MD, None, SAMPLE_SOUL_MD])

    with (
        patch("app.services.deep_dream.memu_retrieve", mock_memu),
        patch("app.services.deep_dream.read_vault_file", mock_read),
    ):
        from app.services.deep_dream import gather_consolidation_inputs

        result = await gather_consolidation_inputs(date(2026, 3, 31))

    assert result is not None
    assert result["daily_log"] == ""


@pytest.mark.asyncio
async def test_validate_passes_valid_output() -> None:
    from app.services.deep_dream import validate_consolidated_output

    consolidation = {
        "memory_md": "# Memory Index\n## Strong Patterns\n- Entry (3x)\n",
        "daily_summary": "Productive day of coding.",
        "stats": {"total_memories_processed": 5},
    }

    result = await validate_consolidated_output(consolidation)

    assert result["line_count"] == 3
    assert result["warnings"] == []
    assert result["memory_md"] == consolidation["memory_md"]


@pytest.mark.asyncio
async def test_validate_truncates_over_200_lines() -> None:
    from app.services.deep_dream import validate_consolidated_output

    long_md = "\n".join(f"- Line {i}" for i in range(250))
    consolidation = {
        "memory_md": long_md,
        "daily_summary": "Summary here.",
        "stats": {},
    }

    result = await validate_consolidated_output(consolidation)

    assert result["line_count"] == 200
    assert len(result["memory_md"].splitlines()) == 200
    assert any("truncat" in w.lower() for w in result["warnings"])


@pytest.mark.asyncio
async def test_validate_rejects_empty_memory_md() -> None:
    from app.services.deep_dream import validate_consolidated_output

    with pytest.raises(ValueError, match="memory_md is empty"):
        await validate_consolidated_output(
            {"memory_md": "", "daily_summary": "Summary.", "stats": {}}
        )


@pytest.mark.asyncio
async def test_validate_rejects_empty_daily_summary() -> None:
    from app.services.deep_dream import validate_consolidated_output

    with pytest.raises(ValueError, match="daily_summary is empty"):
        await validate_consolidated_output(
            {"memory_md": "# Memory\n- entry", "daily_summary": "", "stats": {}}
        )


@pytest.mark.asyncio
async def test_validate_warns_on_relative_dates() -> None:
    from app.services.deep_dream import validate_consolidated_output

    consolidation = {
        "memory_md": "# Memory Index\n- Did something yesterday\n",
        "daily_summary": "Summary.",
        "stats": {},
    }

    result = await validate_consolidated_output(consolidation)

    assert any("relative date" in w.lower() for w in result["warnings"])


@pytest.mark.asyncio
async def test_write_creates_backup() -> None:
    mock_read = AsyncMock(side_effect=["existing MEMORY.md content", ""])
    mock_write = AsyncMock()

    with (
        patch("app.services.deep_dream.read_vault_file", mock_read),
        patch("app.services.deep_dream.write_vault_file", mock_write),
    ):
        from app.services.deep_dream import write_consolidated_files

        await write_consolidated_files(
            {"memory_md": "new content", "daily_summary": "day summary"},
            date(2026, 3, 31),
        )

    backup_call = mock_write.call_args_list[0]
    assert backup_call[0][0] == "topics/memory-backup-2026-03-31.md"
    assert backup_call[0][1] == "existing MEMORY.md content"


@pytest.mark.asyncio
async def test_write_rewrites_memory_md() -> None:
    mock_read = AsyncMock(side_effect=["old content", ""])
    mock_write = AsyncMock()

    with (
        patch("app.services.deep_dream.read_vault_file", mock_read),
        patch("app.services.deep_dream.write_vault_file", mock_write),
    ):
        from app.services.deep_dream import write_consolidated_files

        await write_consolidated_files(
            {"memory_md": "new MEMORY.md", "daily_summary": "day summary"},
            date(2026, 3, 31),
        )

    memory_write = mock_write.call_args_list[1]
    assert memory_write[0][0] == "MEMORY.md"
    assert memory_write[0][1] == "new MEMORY.md"


@pytest.mark.asyncio
async def test_write_rewrites_daily_log() -> None:
    existing_daily = "---\ntype: daily\ndate: 2026-03-31\n---\n\n## Session 1\nOld content."
    mock_read = AsyncMock(side_effect=["old memory", existing_daily])
    mock_write = AsyncMock()

    with (
        patch("app.services.deep_dream.read_vault_file", mock_read),
        patch("app.services.deep_dream.write_vault_file", mock_write),
    ):
        from app.services.deep_dream import write_consolidated_files

        await write_consolidated_files(
            {"memory_md": "new memory", "daily_summary": "Consolidated summary."},
            date(2026, 3, 31),
        )

    daily_write = mock_write.call_args_list[2]
    assert daily_write[0][0] == "dailys/2026-03-31.md"
    written_content: str = daily_write[0][1]
    assert written_content.startswith("---\ntype: daily\ndate: 2026-03-31\n---")
    assert "Consolidated summary." in written_content


@pytest.mark.asyncio
async def test_write_returns_correct_files_modified() -> None:
    mock_read = AsyncMock(side_effect=["old", ""])
    mock_write = AsyncMock()

    with (
        patch("app.services.deep_dream.read_vault_file", mock_read),
        patch("app.services.deep_dream.write_vault_file", mock_write),
    ):
        from app.services.deep_dream import write_consolidated_files

        result = await write_consolidated_files(
            {"memory_md": "new", "daily_summary": "sum"},
            date(2026, 3, 31),
        )

    assert len(result) == 3
    assert result[0] == {"path": "MEMORY.md", "action": "rewrite"}
    assert result[1] == {"path": "dailys/2026-03-31.md", "action": "rewrite"}
    assert result[2] == {"path": "topics/memory-backup-2026-03-31.md", "action": "create"}
