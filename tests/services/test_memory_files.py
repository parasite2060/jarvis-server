from pathlib import Path

import pytest

from app.services.memory_files import read_vault_file, read_vault_file_lines


@pytest.fixture()
def mock_vault(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(
        "app.services.memory_files.settings.ai_memory_repo_path",
        str(tmp_path),
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
