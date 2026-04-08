import hashlib
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.services.file_manifest import (
    VaultFileInfo,
    _scan_and_hash,
    compute_manifest_hash,
    scan_vault_files,
)

TS = datetime(2026, 1, 1, tzinfo=UTC)


@pytest.fixture()
def mock_vault(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(
        "app.services.file_manifest.settings",
        type("_S", (), {"ai_memory_repo_path": str(tmp_path)})(),
    )
    (tmp_path / "SOUL.md").write_text("# Soul\n\nTest soul content", encoding="utf-8")
    (tmp_path / "MEMORY.md").write_text("# Memory\n\nTest memory", encoding="utf-8")
    (tmp_path / "config.yml").write_text("auto_merge: true\n", encoding="utf-8")
    (tmp_path / "decisions").mkdir()
    (tmp_path / "decisions" / "_index.md").write_text("# Decisions\n", encoding="utf-8")
    (tmp_path / ".git").mkdir()
    (tmp_path / ".git" / "config").write_text("", encoding="utf-8")
    (tmp_path / ".hidden-file.md").write_text("hidden", encoding="utf-8")
    (tmp_path / "notes.txt").write_text("plain text", encoding="utf-8")
    return tmp_path


def test_scan_and_hash_includes_md_and_yml(mock_vault: Path) -> None:
    files = _scan_and_hash(mock_vault)
    paths = {f.relative_path for f in files}

    assert "SOUL.md" in paths
    assert "MEMORY.md" in paths
    assert "config.yml" in paths
    assert "decisions/_index.md" in paths


def test_scan_and_hash_excludes_hidden_and_git(mock_vault: Path) -> None:
    files = _scan_and_hash(mock_vault)
    paths = {f.relative_path for f in files}

    assert ".hidden-file.md" not in paths
    assert not any(".git" in p for p in paths)


def test_scan_and_hash_excludes_non_vault_extensions(mock_vault: Path) -> None:
    files = _scan_and_hash(mock_vault)
    paths = {f.relative_path for f in files}

    assert "notes.txt" not in paths


def test_scan_and_hash_correct_sha256(mock_vault: Path) -> None:
    files = _scan_and_hash(mock_vault)
    soul_file = next(f for f in files if f.relative_path == "SOUL.md")

    raw_bytes = (mock_vault / "SOUL.md").read_bytes()
    expected_hash = hashlib.sha256(raw_bytes).hexdigest()
    assert soul_file.content_hash == expected_hash


def test_scan_and_hash_correct_file_size(mock_vault: Path) -> None:
    files = _scan_and_hash(mock_vault)
    soul_file = next(f for f in files if f.relative_path == "SOUL.md")

    raw_bytes = (mock_vault / "SOUL.md").read_bytes()
    assert soul_file.file_size == len(raw_bytes)


@pytest.mark.asyncio
async def test_scan_vault_files_returns_files(mock_vault: Path) -> None:
    files = await scan_vault_files()

    assert len(files) == 4


def test_compute_manifest_hash_deterministic() -> None:
    files = [
        VaultFileInfo(relative_path="a.md", content_hash="aaa", file_size=10, updated_at=TS),
        VaultFileInfo(relative_path="b.md", content_hash="bbb", file_size=20, updated_at=TS),
    ]

    assert compute_manifest_hash(files) == compute_manifest_hash(files)


def test_compute_manifest_hash_changes_when_file_changes() -> None:
    files_v1 = [
        VaultFileInfo(relative_path="a.md", content_hash="aaa", file_size=10, updated_at=TS),
    ]
    files_v2 = [
        VaultFileInfo(relative_path="a.md", content_hash="bbb", file_size=10, updated_at=TS),
    ]

    assert compute_manifest_hash(files_v1) != compute_manifest_hash(files_v2)


def test_compute_manifest_hash_sorted_order() -> None:
    files_ab = [
        VaultFileInfo(relative_path="a.md", content_hash="aaa", file_size=10, updated_at=TS),
        VaultFileInfo(relative_path="b.md", content_hash="bbb", file_size=20, updated_at=TS),
    ]
    files_ba = [
        VaultFileInfo(relative_path="b.md", content_hash="bbb", file_size=20, updated_at=TS),
        VaultFileInfo(relative_path="a.md", content_hash="aaa", file_size=10, updated_at=TS),
    ]

    assert compute_manifest_hash(files_ab) == compute_manifest_hash(files_ba)


def test_scan_and_hash_empty_directory(tmp_path: Path) -> None:
    files = _scan_and_hash(tmp_path)

    assert files == []


def test_scan_and_hash_excludes_backups(tmp_path: Path) -> None:
    backups_dir = tmp_path / ".backups"
    backups_dir.mkdir()
    (backups_dir / "snapshot.md").write_text("# Backup", encoding="utf-8")
    (tmp_path / "SOUL.md").write_text("# Soul", encoding="utf-8")

    files = _scan_and_hash(tmp_path)
    paths = {f.relative_path for f in files}

    assert "SOUL.md" in paths
    assert not any(".backups" in p for p in paths)


def test_scan_and_hash_includes_new_vault_folders(tmp_path: Path) -> None:
    for folder in ("concepts", "connections", "lessons", "references", "reviews"):
        folder_path = tmp_path / folder
        folder_path.mkdir()
        (folder_path / "_index.md").write_text(f"# {folder.title()} Index\n", encoding="utf-8")

    files = _scan_and_hash(tmp_path)
    paths = {f.relative_path for f in files}

    assert "concepts/_index.md" in paths
    assert "connections/_index.md" in paths
    assert "lessons/_index.md" in paths
    assert "references/_index.md" in paths
    assert "reviews/_index.md" in paths
