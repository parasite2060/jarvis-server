import datetime
from pathlib import Path

import pytest

from app.services.context_assembly import MAX_MEMORY_LINES, assemble_context

SETTINGS_MODULE = "app.services.memory_files.settings"


@pytest.fixture()
def mock_vault(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(
        SETTINGS_MODULE,
        type("_S", (), {"ai_memory_repo_path": str(tmp_path)})(),
    )

    soul = "---\ntype: soul\n---\n# Soul\nSoul content"
    (tmp_path / "SOUL.md").write_text(soul, encoding="utf-8")
    identity = "---\ntype: identity\n---\n# Identity\nIdentity content"
    (tmp_path / "IDENTITY.md").write_text(identity, encoding="utf-8")

    memory_lines = "\n".join(f"memory line {i}" for i in range(300))
    (tmp_path / "MEMORY.md").write_text(memory_lines, encoding="utf-8")

    (tmp_path / "dailys").mkdir()
    today = datetime.date.today().isoformat()
    yesterday_dt = datetime.date.today() - datetime.timedelta(days=1)
    yesterday = yesterday_dt.isoformat()
    (tmp_path / "dailys" / f"{today}.md").write_text("Today's log", encoding="utf-8")
    (tmp_path / "dailys" / f"{yesterday}.md").write_text("Yesterday's log", encoding="utf-8")

    for folder in ["decisions", "projects", "patterns", "templates"]:
        (tmp_path / folder).mkdir()
        (tmp_path / folder / "_index.md").write_text(
            f"# {folder.title()} Index\n", encoding="utf-8"
        )

    return tmp_path


@pytest.mark.asyncio
async def test_assemble_context_includes_all_sections(
    mock_vault: Path,
) -> None:
    result = await assemble_context()

    assert "## SOUL" in result
    assert "Soul content" in result
    assert "## IDENTITY" in result
    assert "Identity content" in result
    assert "## MEMORY" in result
    assert "## DECISIONS INDEX" in result
    assert "## PROJECTS INDEX" in result
    assert "## PATTERNS INDEX" in result
    assert "## TEMPLATES INDEX" in result
    assert "## MEMORY TOOLS" in result
    assert "memory_search" in result


@pytest.mark.asyncio
async def test_assemble_context_caps_memory_at_200_lines(
    mock_vault: Path,
) -> None:
    result = await assemble_context()

    memory_start = result.index("## MEMORY")
    today_str = datetime.date.today().isoformat()
    memory_end = result.index(f"## TODAY ({today_str})")
    memory_section = result[memory_start:memory_end].strip()
    # skip header + blank line
    memory_content_lines = memory_section.split("\n")[2:]
    assert len(memory_content_lines) == MAX_MEMORY_LINES


@pytest.mark.asyncio
async def test_assemble_context_includes_daily_logs(
    mock_vault: Path,
) -> None:
    result = await assemble_context()

    today = datetime.date.today().isoformat()
    yesterday_dt = datetime.date.today() - datetime.timedelta(days=1)
    yesterday = yesterday_dt.isoformat()
    assert f"## TODAY ({today})" in result
    assert "Today's log" in result
    assert f"## YESTERDAY ({yesterday})" in result
    assert "Yesterday's log" in result


@pytest.mark.asyncio
async def test_assemble_context_skips_missing_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        SETTINGS_MODULE,
        type("_S", (), {"ai_memory_repo_path": str(tmp_path)})(),
    )

    (tmp_path / "SOUL.md").write_text("# Soul\nMinimal", encoding="utf-8")

    result = await assemble_context()

    assert "## SOUL" in result
    assert "Minimal" in result
    assert "## MEMORY TOOLS" in result
    assert "## IDENTITY" not in result
    assert "## MEMORY\n" not in result
