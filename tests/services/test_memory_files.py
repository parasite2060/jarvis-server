from pathlib import Path

import pytest

from app.services.memory_files import (
    ALLOWED_LOG_ACTIONS,
    append_vault_log,
    read_vault_file,
    read_vault_file_lines,
)


@pytest.fixture()
def mock_vault(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(
        "app.services.memory_files.settings",
        type("_S", (), {"ai_memory_repo_path": str(tmp_path)})(),
    )
    soul = "---\ntype: soul\n---\n# Soul\n\nTest soul content"
    (tmp_path / "SOUL.md").write_text(soul, encoding="utf-8")
    (tmp_path / "subdir").mkdir()
    (tmp_path / "subdir" / "nested.md").write_text("nested content", encoding="utf-8")
    return tmp_path


@pytest.mark.asyncio
async def test_read_vault_file_returns_content(mock_vault: Path) -> None:
    content = await read_vault_file("SOUL.md")

    assert content is not None
    assert "Test soul content" in content


@pytest.mark.asyncio
async def test_read_vault_file_returns_none_for_missing(mock_vault: Path) -> None:
    content = await read_vault_file("NONEXISTENT.md")

    assert content is None


@pytest.mark.asyncio
async def test_read_vault_file_blocks_path_traversal(mock_vault: Path) -> None:
    content = await read_vault_file("../../etc/passwd")

    assert content is None


@pytest.mark.asyncio
async def test_read_vault_file_reads_nested_file(mock_vault: Path) -> None:
    content = await read_vault_file("subdir/nested.md")

    assert content == "nested content"


@pytest.mark.asyncio
async def test_read_vault_file_lines_caps_lines(mock_vault: Path) -> None:
    lines = "\n".join(f"line {i}" for i in range(50))
    (mock_vault / "big.md").write_text(lines, encoding="utf-8")

    content = await read_vault_file_lines("big.md", max_lines=10)

    assert content is not None
    assert len(content.splitlines()) == 10
    assert content.startswith("line 0")


@pytest.mark.asyncio
async def test_read_vault_file_lines_returns_none_for_missing(mock_vault: Path) -> None:
    content = await read_vault_file_lines("NONEXISTENT.md", max_lines=10)

    assert content is None


# --- append_vault_log tests ---


@pytest.mark.asyncio
async def test_append_vault_log_creates_log_file(mock_vault: Path) -> None:
    await append_vault_log("ingest", "test entry")

    log_path = mock_vault / "log.md"
    assert log_path.exists()
    content = log_path.read_text(encoding="utf-8")
    assert "- [ingest] test entry" in content


@pytest.mark.asyncio
async def test_append_vault_log_appends_to_existing(mock_vault: Path) -> None:
    log_path = mock_vault / "log.md"
    log_path.write_text("# Vault Change Log\n", encoding="utf-8")

    await append_vault_log("ingest", "first entry")
    await append_vault_log("review", "second entry")

    content = log_path.read_text(encoding="utf-8")
    assert "# Vault Change Log" in content
    assert "- [ingest] first entry" in content
    assert "- [review] second entry" in content


@pytest.mark.asyncio
async def test_append_vault_log_formats_with_timestamp_header(mock_vault: Path) -> None:
    await append_vault_log("create", "decisions/test.md")

    content = (mock_vault / "log.md").read_text(encoding="utf-8")
    lines = content.strip().splitlines()
    header_lines = [ln for ln in lines if ln.startswith("## ")]
    assert len(header_lines) == 1
    assert len(header_lines[0]) == len("## YYYY-MM-DD HH:MM")
    entry_lines = [ln for ln in lines if ln.startswith("- [")]
    assert entry_lines == ["- [create] decisions/test.md"]


@pytest.mark.asyncio
async def test_append_vault_log_rejects_invalid_action(mock_vault: Path) -> None:
    await append_vault_log("invalid_action", "should not appear")

    log_path = mock_vault / "log.md"
    assert not log_path.exists()


@pytest.mark.asyncio
@pytest.mark.parametrize("action", list(ALLOWED_LOG_ACTIONS))
async def test_append_vault_log_accepts_all_valid_actions(
    mock_vault: Path, action: str
) -> None:
    await append_vault_log(action, f"test {action}")

    content = (mock_vault / "log.md").read_text(encoding="utf-8")
    assert f"- [{action}] test {action}" in content
