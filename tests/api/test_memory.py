from pathlib import Path

import pytest
from httpx import AsyncClient

from app.services import context_cache

API_KEY = "test-api-key"
AUTH_HEADER = {"Authorization": f"Bearer {API_KEY}"}
SETTINGS_MODULE = "app.services.memory_files.settings"


@pytest.fixture(autouse=True)
def _clear_cache() -> None:
    context_cache._cache.clear()
    context_cache._expires_at = None


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
    (tmp_path / "MEMORY.md").write_text("# Memory\nEntry 1", encoding="utf-8")
    return tmp_path


# --- Authentication tests ---


@pytest.mark.asyncio
async def test_context_returns_401_without_auth(
    client: AsyncClient,
) -> None:
    response = await client.get("/memory/context")

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_context_returns_401_with_invalid_key(
    client: AsyncClient,
) -> None:
    response = await client.get(
        "/memory/context",
        headers={"Authorization": "Bearer wrong-key"},
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_soul_returns_401_with_invalid_key(
    client: AsyncClient,
) -> None:
    response = await client.get(
        "/memory/soul",
        headers={"Authorization": "Bearer wrong-key"},
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_identity_returns_401_with_invalid_key(
    client: AsyncClient,
) -> None:
    response = await client.get(
        "/memory/identity",
        headers={"Authorization": "Bearer wrong-key"},
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_memory_returns_401_with_invalid_key(
    client: AsyncClient,
) -> None:
    response = await client.get(
        "/memory/memory",
        headers={"Authorization": "Bearer wrong-key"},
    )

    assert response.status_code == 401


# --- Context endpoint tests ---


@pytest.mark.asyncio
async def test_context_returns_assembled_content(client: AsyncClient, mock_vault: Path) -> None:
    response = await client.get("/memory/context", headers=AUTH_HEADER)
    body = response.json()

    assert response.status_code == 200
    assert body["status"] == "ok"
    assert "Soul content" in body["data"]["context"]
    assert body["data"]["cached"] is False
    assert "assembledAt" in body["data"]


@pytest.mark.asyncio
async def test_context_returns_cached_on_second_call(client: AsyncClient, mock_vault: Path) -> None:
    await client.get("/memory/context", headers=AUTH_HEADER)
    response = await client.get("/memory/context", headers=AUTH_HEADER)
    body = response.json()

    assert response.status_code == 200
    assert body["data"]["cached"] is True


# --- Soul endpoint tests ---


@pytest.mark.asyncio
async def test_soul_returns_content(client: AsyncClient, mock_vault: Path) -> None:
    response = await client.get("/memory/soul", headers=AUTH_HEADER)
    body = response.json()

    assert response.status_code == 200
    assert body["status"] == "ok"
    assert "Soul content" in body["data"]["content"]
    assert body["data"]["filePath"] == "SOUL.md"


@pytest.mark.asyncio
async def test_soul_returns_404_when_missing(
    client: AsyncClient,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        SETTINGS_MODULE,
        type("_S", (), {"ai_memory_repo_path": str(tmp_path)})(),
    )

    response = await client.get("/memory/soul", headers=AUTH_HEADER)

    assert response.status_code == 404


# --- Identity endpoint tests ---


@pytest.mark.asyncio
async def test_identity_returns_content(client: AsyncClient, mock_vault: Path) -> None:
    response = await client.get("/memory/identity", headers=AUTH_HEADER)
    body = response.json()

    assert response.status_code == 200
    assert body["status"] == "ok"
    assert "Identity content" in body["data"]["content"]
    assert body["data"]["filePath"] == "IDENTITY.md"


@pytest.mark.asyncio
async def test_identity_returns_404_when_missing(
    client: AsyncClient,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        SETTINGS_MODULE,
        type("_S", (), {"ai_memory_repo_path": str(tmp_path)})(),
    )

    response = await client.get("/memory/identity", headers=AUTH_HEADER)

    assert response.status_code == 404


# --- Memory endpoint tests ---


@pytest.mark.asyncio
async def test_memory_returns_content(client: AsyncClient, mock_vault: Path) -> None:
    response = await client.get("/memory/memory", headers=AUTH_HEADER)
    body = response.json()

    assert response.status_code == 200
    assert body["status"] == "ok"
    assert "Entry 1" in body["data"]["content"]
    assert body["data"]["filePath"] == "MEMORY.md"


@pytest.mark.asyncio
async def test_memory_returns_404_when_missing(
    client: AsyncClient,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        SETTINGS_MODULE,
        type("_S", (), {"ai_memory_repo_path": str(tmp_path)})(),
    )

    response = await client.get("/memory/memory", headers=AUTH_HEADER)

    assert response.status_code == 404
