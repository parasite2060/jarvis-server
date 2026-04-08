from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

API_KEY = "test-api-key"
AUTH_HEADER = {"Authorization": f"Bearer {API_KEY}"}
MANIFEST_SETTINGS = "app.services.file_manifest.settings"
FILES_SETTINGS = "app.api.routes.files.settings"
MEMORY_FILES_SETTINGS = "app.services.memory_files.settings"


@pytest.fixture()
def mock_vault(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    _mock = type("_S", (), {"ai_memory_repo_path": str(tmp_path)})()
    monkeypatch.setattr(MANIFEST_SETTINGS, _mock)
    monkeypatch.setattr(FILES_SETTINGS, _mock)
    monkeypatch.setattr(MEMORY_FILES_SETTINGS, _mock)
    (tmp_path / "SOUL.md").write_text("# Soul\n\nTest soul content", encoding="utf-8")
    (tmp_path / "IDENTITY.md").write_text("# Identity\n\nTest identity", encoding="utf-8")
    (tmp_path / "MEMORY.md").write_text("# Memory\n\nTest memory", encoding="utf-8")
    (tmp_path / "config.yml").write_text("auto_merge: true\n", encoding="utf-8")
    (tmp_path / "decisions").mkdir()
    (tmp_path / "decisions" / "_index.md").write_text("# Decisions\n", encoding="utf-8")
    (tmp_path / ".git").mkdir()
    (tmp_path / ".git" / "config").write_text("", encoding="utf-8")
    (tmp_path / ".hidden-file.md").write_text("hidden", encoding="utf-8")
    return tmp_path


# --- Manifest endpoint tests ---


@pytest.mark.asyncio
@patch("app.api.routes.files.sync_file_manifest_to_db", new_callable=AsyncMock)
async def test_manifest_returns_correct_structure(
    _mock_sync: AsyncMock,
    client: AsyncClient,
    mock_vault: Path,
) -> None:
    response = await client.get("/memory/files/manifest", headers=AUTH_HEADER)
    body = response.json()

    assert response.status_code == 200
    assert body["status"] == "ok"
    assert "files" in body["data"]
    assert "manifestHash" in body["data"]
    assert "fileCount" in body["data"]
    assert "generatedAt" in body["data"]
    assert body["data"]["fileCount"] == 5
    for entry in body["data"]["files"]:
        assert "path" in entry
        assert "hash" in entry
        assert "size" in entry
        assert "updatedAt" in entry


@pytest.mark.asyncio
async def test_manifest_returns_401_without_auth(
    client: AsyncClient,
) -> None:
    response = await client.get("/memory/files/manifest")

    assert response.status_code == 401


@pytest.mark.asyncio
@patch("app.api.routes.files.sync_file_manifest_to_db", new_callable=AsyncMock)
async def test_manifest_excludes_hidden_and_git(
    _mock_sync: AsyncMock,
    client: AsyncClient,
    mock_vault: Path,
) -> None:
    response = await client.get("/memory/files/manifest", headers=AUTH_HEADER)
    body = response.json()
    paths = {entry["path"] for entry in body["data"]["files"]}

    assert ".hidden-file.md" not in paths
    assert not any(".git" in p for p in paths)


# --- File serve endpoint tests ---


@pytest.mark.asyncio
async def test_file_serve_returns_content(
    client: AsyncClient,
    mock_vault: Path,
) -> None:
    response = await client.get("/memory/files/SOUL.md", headers=AUTH_HEADER)
    body = response.json()

    assert response.status_code == 200
    assert body["status"] == "ok"
    assert "# Soul" in body["data"]["content"]
    assert body["data"]["filePath"] == "SOUL.md"
    assert "hash" in body["data"]
    assert body["data"]["size"] > 0


@pytest.mark.asyncio
async def test_file_serve_returns_404_for_missing(
    client: AsyncClient,
    mock_vault: Path,
) -> None:
    response = await client.get("/memory/files/NONEXISTENT.md", headers=AUTH_HEADER)

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_file_serve_returns_400_for_path_traversal(
    client: AsyncClient,
    mock_vault: Path,
) -> None:
    response = await client.get(
        "/memory/files/%2e%2e/%2e%2e/%2e%2e/etc/passwd",
        headers=AUTH_HEADER,
    )

    assert response.status_code == 400
    body = response.json()
    assert body["detail"]["error"]["code"] == "INVALID_PATH"


@pytest.mark.asyncio
async def test_file_serve_returns_401_without_auth(
    client: AsyncClient,
) -> None:
    response = await client.get("/memory/files/SOUL.md")

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_file_serve_nested_path(
    client: AsyncClient,
    mock_vault: Path,
) -> None:
    response = await client.get(
        "/memory/files/decisions/_index.md",
        headers=AUTH_HEADER,
    )
    body = response.json()

    assert response.status_code == 200
    assert body["data"]["filePath"] == "decisions/_index.md"
    assert "# Decisions" in body["data"]["content"]
