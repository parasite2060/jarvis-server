from datetime import date
from pathlib import Path

import pytest

from app.services.memory_updater import (
    MemoryItem,
    append_to_daily_log,
    append_to_memory_md,
    update_memory_files,
)


@pytest.fixture()
def mock_vault(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(
        "app.services.memory_files.settings.ai_memory_repo_path",
        str(tmp_path),
    )
    (tmp_path / "dailys").mkdir()
    return tmp_path


SAMPLE_MEMORIES = [
    MemoryItem(
        type="decision",
        content="Use FastAPI for server",
        reasoning="async-first and Pydantic",
    ),
    MemoryItem(type="preference", content="Prefer httpx over requests"),
    MemoryItem(type="fact", content="Project uses PostgreSQL with pgvector"),
]

SAMPLE_DECISION = [
    MemoryItem(
        type="decision",
        content="Use structlog for JSON logging",
        reasoning="grep-able without extra infra",
    ),
]


@pytest.mark.asyncio
async def test_append_to_memory_md_under_recent(mock_vault: Path) -> None:
    existing = (
        "# MEMORY.md\n\n"
        "## Strong Patterns\n\n"
        "## Decisions\n\n"
        "## Facts\n\n"
        "## Recent\n\n"
        "### 2026-03-30 10:00\n\n"
        "- [fact] Old entry\n"
    )
    (mock_vault / "MEMORY.md").write_text(existing, encoding="utf-8")

    result = await append_to_memory_md(SAMPLE_MEMORIES, "Test session", date(2026, 3, 31))

    assert result["path"] == "MEMORY.md"
    assert result["action"] == "append"
    assert isinstance(result["line_count"], int)

    content = (mock_vault / "MEMORY.md").read_text(encoding="utf-8")
    # New entry should be before old entry (newest first)
    new_pos = content.find("### 2026-03-31")
    old_pos = content.find("### 2026-03-30")
    assert new_pos < old_pos
    assert "- [decision] Use FastAPI for server -- async-first and Pydantic" in content
    assert "- [preference] Prefer httpx over requests" in content
    assert "- [fact] Old entry" in content


@pytest.mark.asyncio
async def test_append_to_memory_md_preserves_existing(mock_vault: Path) -> None:
    existing = (
        "# MEMORY.md\n\n"
        "## Strong Patterns\n\n"
        "- Pattern A\n\n"
        "## Recent\n\n"
        "### 2026-03-29 08:00\n\n"
        "- [fact] Existing fact\n"
    )
    (mock_vault / "MEMORY.md").write_text(existing, encoding="utf-8")

    await append_to_memory_md(SAMPLE_MEMORIES, "Test", date(2026, 3, 31))

    content = (mock_vault / "MEMORY.md").read_text(encoding="utf-8")
    assert "## Strong Patterns" in content
    assert "- Pattern A" in content
    assert "- [fact] Existing fact" in content


@pytest.mark.asyncio
async def test_append_to_memory_md_formats_decisions_with_reasoning(mock_vault: Path) -> None:
    (mock_vault / "MEMORY.md").write_text("## Recent\n", encoding="utf-8")

    await append_to_memory_md(SAMPLE_DECISION, "Test", date(2026, 3, 31))

    content = (mock_vault / "MEMORY.md").read_text(encoding="utf-8")
    assert "- [decision] Use structlog for JSON logging -- grep-able without extra infra" in content


@pytest.mark.asyncio
async def test_append_to_memory_md_overflow_flag(mock_vault: Path) -> None:
    lines = ["## Recent\n"] + [f"- [fact] Line {i}\n" for i in range(180)]
    (mock_vault / "MEMORY.md").write_text("".join(lines), encoding="utf-8")

    result = await append_to_memory_md(SAMPLE_MEMORIES, "Test", date(2026, 3, 31))

    assert result["memory_overflow"] is True


@pytest.mark.asyncio
async def test_append_to_memory_md_no_overflow_flag(mock_vault: Path) -> None:
    (mock_vault / "MEMORY.md").write_text("## Recent\n", encoding="utf-8")

    result = await append_to_memory_md(SAMPLE_MEMORIES, "Test", date(2026, 3, 31))

    assert result["memory_overflow"] is False


@pytest.mark.asyncio
async def test_append_to_daily_log_creates_new_file(mock_vault: Path) -> None:
    result = await append_to_daily_log(SAMPLE_MEMORIES, "First session", date(2026, 3, 31))

    assert result["path"] == "dailys/2026-03-31.md"
    assert result["action"] == "create"

    content = (mock_vault / "dailys" / "2026-03-31.md").read_text(encoding="utf-8")
    assert "type: daily" in content
    assert "tags: [daily, sessions]" in content
    assert "created: 2026-03-31" in content
    assert "## Session 1" in content
    assert "**Summary:** First session" in content
    assert "- [decision] Use FastAPI for server -- async-first and Pydantic" in content


@pytest.mark.asyncio
async def test_append_to_daily_log_appends_to_existing(mock_vault: Path) -> None:
    existing = (
        "---\n"
        "type: daily\n"
        "tags: [daily, sessions]\n"
        "created: 2026-03-31\n"
        "updated: 2026-03-31\n"
        "---\n\n"
        "# 2026-03-31\n\n"
        "## Session 1\n\n"
        "**Summary:** Earlier session\n\n"
        "**Memories extracted:**\n"
        "- [fact] Old fact\n"
    )
    (mock_vault / "dailys" / "2026-03-31.md").write_text(existing, encoding="utf-8")

    result = await append_to_daily_log(SAMPLE_MEMORIES, "Second session", date(2026, 3, 31))

    assert result["action"] == "append"

    content = (mock_vault / "dailys" / "2026-03-31.md").read_text(encoding="utf-8")
    assert "## Session 1" in content
    assert "## Session 2" in content
    assert "**Summary:** Second session" in content
    assert "- [fact] Old fact" in content


@pytest.mark.asyncio
async def test_append_to_daily_log_updates_frontmatter(mock_vault: Path) -> None:
    existing = (
        "---\n"
        "type: daily\n"
        "tags: [daily, sessions]\n"
        "created: 2026-03-30\n"
        "updated: 2026-03-30\n"
        "---\n\n"
        "# 2026-03-30\n"
    )
    (mock_vault / "dailys" / "2026-03-31.md").write_text(existing, encoding="utf-8")

    await append_to_daily_log(SAMPLE_MEMORIES, "New session", date(2026, 3, 31))

    content = (mock_vault / "dailys" / "2026-03-31.md").read_text(encoding="utf-8")
    assert "updated: 2026-03-31" in content


@pytest.mark.asyncio
async def test_update_memory_files_calls_both(mock_vault: Path) -> None:
    (mock_vault / "MEMORY.md").write_text("## Recent\n", encoding="utf-8")

    results = await update_memory_files(1, SAMPLE_MEMORIES, "Test session", date(2026, 3, 31))

    assert len(results) == 2
    paths = {r["path"] for r in results}
    assert "MEMORY.md" in paths
    assert "dailys/2026-03-31.md" in paths


@pytest.mark.asyncio
async def test_update_memory_files_partial_success(
    mock_vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (mock_vault / "MEMORY.md").write_text("## Recent\n", encoding="utf-8")

    # Make daily log write fail by removing dailys dir and creating a file in its place
    import shutil

    shutil.rmtree(mock_vault / "dailys")
    # Write MEMORY.md atomically involves tmp files in parent dir, which works.
    # To make daily log fail, we make the dailys path a file instead of a directory.
    (mock_vault / "dailys").write_text("not a directory", encoding="utf-8")

    results = await update_memory_files(1, SAMPLE_MEMORIES, "Test session", date(2026, 3, 31))

    assert len(results) == 2
    memory_result = next(r for r in results if r["path"] == "MEMORY.md")
    daily_result = next(r for r in results if "dailys" in str(r["path"]))
    assert memory_result["action"] == "append"
    assert daily_result["action"] == "error"
    assert "error" in daily_result
