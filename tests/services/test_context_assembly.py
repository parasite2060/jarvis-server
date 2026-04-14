import datetime
import json
from collections.abc import Generator
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from app.services.context_assembly import (
    MAX_MEMORY_LINES,
    assemble_context,
    format_health_summary,
    get_latest_health_report,
)
from app.services.dream_models import HealthReport

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


@pytest.fixture(autouse=True)
def _no_health_report() -> Generator[None, None, None]:
    with patch(
        "app.services.context_assembly.get_latest_health_report",
        return_value=None,
    ):
        yield


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


# ---------------------------------------------------------------------------
# format_health_summary tests
# ---------------------------------------------------------------------------


def test_format_health_summary_with_all_issues() -> None:
    report = HealthReport(
        orphan_notes=["a.md", "b.md"],
        stale_notes=["c.md"],
        unresolved_contradictions=["d.md"],
        missing_frontmatter=["e.md", "f.md", "g.md"],
        memory_overflow=True,
        knowledge_gaps=["topic-x", "topic-y"],
        total_issues=10,
    )
    result = format_health_summary(report)
    assert result.startswith("\u26a0 Vault health:")
    assert "2 orphan notes" in result
    assert "1 stale notes" in result
    assert "1 unresolved contradictions" in result
    assert "3 missing frontmatter" in result
    assert "MEMORY.md approaching overflow" in result
    assert "2 knowledge gaps" in result


def test_format_health_summary_with_no_issues() -> None:
    report = HealthReport(total_issues=0)
    result = format_health_summary(report)
    assert result == ""


def test_format_health_summary_with_partial_issues() -> None:
    report = HealthReport(
        orphan_notes=["a.md"],
        memory_overflow=True,
        total_issues=2,
    )
    result = format_health_summary(report)
    assert "1 orphan notes" in result
    assert "MEMORY.md approaching overflow" in result
    assert "stale" not in result
    assert "contradictions" not in result


# ---------------------------------------------------------------------------
# get_latest_health_report tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_latest_health_report_with_valid_dream() -> None:
    health_data = {
        "orphan_notes": ["x.md"],
        "stale_notes": [],
        "missing_frontmatter": [],
        "unresolved_contradictions": [],
        "memory_overflow": False,
        "knowledge_gaps": [],
        "total_issues": 1,
    }
    output_raw = f"line_count=50, health_report={json.dumps(health_data)}"

    mock_dream = type("MockDream", (), {"output_raw": output_raw})()
    mock_result = type("MockResult", (), {"scalar_one_or_none": lambda self: mock_dream})()

    mock_session = AsyncMock()
    mock_session.execute.return_value = mock_result
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    with patch("app.services.context_assembly.async_session_factory", return_value=mock_session):
        report = await get_latest_health_report()

    assert report is not None
    assert report.orphan_notes == ["x.md"]
    assert report.total_issues == 1


@pytest.mark.asyncio
async def test_get_latest_health_report_no_dreams() -> None:
    mock_result = type("MockResult", (), {"scalar_one_or_none": lambda self: None})()

    mock_session = AsyncMock()
    mock_session.execute.return_value = mock_result
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    with patch("app.services.context_assembly.async_session_factory", return_value=mock_session):
        report = await get_latest_health_report()

    assert report is None


@pytest.mark.asyncio
async def test_get_latest_health_report_dream_without_health_data() -> None:
    mock_dream = type("MockDream", (), {"output_raw": "line_count=50, total_processed=10"})()
    mock_result = type("MockResult", (), {"scalar_one_or_none": lambda self: mock_dream})()

    mock_session = AsyncMock()
    mock_session.execute.return_value = mock_result
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    with patch("app.services.context_assembly.async_session_factory", return_value=mock_session):
        report = await get_latest_health_report()

    assert report is None


# ---------------------------------------------------------------------------
# assemble_context with health report injection
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_assemble_context_includes_health_when_issues_exist(
    mock_vault: Path,
) -> None:
    report = HealthReport(
        orphan_notes=["a.md", "b.md", "c.md"],
        stale_notes=["d.md", "e.md"],
        total_issues=5,
    )
    with patch(
        "app.services.context_assembly.get_latest_health_report",
        return_value=report,
    ):
        result = await assemble_context()

    assert "## VAULT HEALTH" in result
    assert "3 orphan notes" in result
    assert "2 stale notes" in result
    # Health section should appear before MEMORY TOOLS
    health_pos = result.index("## VAULT HEALTH")
    tools_pos = result.index("## MEMORY TOOLS")
    assert health_pos < tools_pos


@pytest.mark.asyncio
async def test_assemble_context_omits_health_when_no_issues(
    mock_vault: Path,
) -> None:
    report = HealthReport(total_issues=0)
    with patch(
        "app.services.context_assembly.get_latest_health_report",
        return_value=report,
    ):
        result = await assemble_context()

    assert "## VAULT HEALTH" not in result
    assert "Vault health" not in result


@pytest.mark.asyncio
async def test_assemble_context_omits_health_when_no_report(
    mock_vault: Path,
) -> None:
    with patch(
        "app.services.context_assembly.get_latest_health_report",
        return_value=None,
    ):
        result = await assemble_context()

    assert "## VAULT HEALTH" not in result
