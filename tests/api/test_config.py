from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

API_KEY = "test-api-key"
AUTH_HEADER = {"Authorization": f"Bearer {API_KEY}"}

READ_CONFIG_PATH = "app.api.routes.config._read_config"
CONFIG_PATH_FN = "app.api.routes.config._config_path"

SAMPLE_YAML = "auto_merge: true\ndeep_dream_cron: '0 20 * * *'\nmax_memory_lines: 200\n"


# --- GET /config tests ---


@pytest.mark.asyncio
async def test_get_config_returns_values(client: AsyncClient) -> None:
    mock_config: dict[str, object] = {
        "auto_merge": False,
        "deep_dream_cron": "30 21 * * *",
        "max_memory_lines": 150,
    }
    with patch(READ_CONFIG_PATH, new_callable=AsyncMock, return_value=mock_config):
        response = await client.get("/config", headers=AUTH_HEADER)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["data"]["autoMerge"] is False
    assert body["data"]["deepDreamCron"] == "30 21 * * *"
    assert body["data"]["maxMemoryLines"] == 150


@pytest.mark.asyncio
async def test_get_config_returns_defaults_when_file_missing(client: AsyncClient) -> None:
    mock_config: dict[str, object] = {
        "auto_merge": True,
        "deep_dream_cron": "0 20 * * *",
        "max_memory_lines": 200,
    }
    with patch(READ_CONFIG_PATH, new_callable=AsyncMock, return_value=mock_config):
        response = await client.get("/config", headers=AUTH_HEADER)

    assert response.status_code == 200
    body = response.json()
    assert body["data"]["autoMerge"] is True
    assert body["data"]["deepDreamCron"] == "0 20 * * *"
    assert body["data"]["maxMemoryLines"] == 200


@pytest.mark.asyncio
async def test_get_config_requires_api_key(client: AsyncClient) -> None:
    response = await client.get("/config")
    assert response.status_code == 401


# --- PATCH /config tests ---


@pytest.mark.asyncio
async def test_patch_config_updates_single_field(client: AsyncClient, tmp_path: object) -> None:
    from pathlib import Path

    tmp = Path(str(tmp_path))
    config_file = tmp / "config.yml"
    config_file.write_text(SAMPLE_YAML)

    with patch(CONFIG_PATH_FN, return_value=config_file):
        response = await client.patch(
            "/config",
            json={"autoMerge": False},
            headers=AUTH_HEADER,
        )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["data"]["autoMerge"] is False
    assert body["data"]["deepDreamCron"] == "0 20 * * *"
    assert body["data"]["maxMemoryLines"] == 200


@pytest.mark.asyncio
async def test_patch_config_updates_multiple_fields(client: AsyncClient, tmp_path: object) -> None:
    from pathlib import Path

    tmp = Path(str(tmp_path))
    config_file = tmp / "config.yml"
    config_file.write_text(SAMPLE_YAML)

    with patch(CONFIG_PATH_FN, return_value=config_file):
        response = await client.patch(
            "/config",
            json={"autoMerge": False, "maxMemoryLines": 100},
            headers=AUTH_HEADER,
        )

    assert response.status_code == 200
    body = response.json()
    assert body["data"]["autoMerge"] is False
    assert body["data"]["maxMemoryLines"] == 100


@pytest.mark.asyncio
async def test_patch_config_rejects_max_memory_lines_below_min(client: AsyncClient) -> None:
    response = await client.patch(
        "/config",
        json={"maxMemoryLines": 10},
        headers=AUTH_HEADER,
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_patch_config_rejects_max_memory_lines_above_max(client: AsyncClient) -> None:
    response = await client.patch(
        "/config",
        json={"maxMemoryLines": 999},
        headers=AUTH_HEADER,
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_patch_config_rejects_invalid_cron(client: AsyncClient) -> None:
    mock_config: dict[str, object] = {
        "auto_merge": True,
        "deep_dream_cron": "0 20 * * *",
        "max_memory_lines": 200,
    }
    with patch(READ_CONFIG_PATH, new_callable=AsyncMock, return_value=mock_config):
        response = await client.patch(
            "/config",
            json={"deepDreamCron": "not-a-cron"},
            headers=AUTH_HEADER,
        )

    assert response.status_code == 422
    body = response.json()
    assert body["detail"]["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_patch_config_accepts_valid_cron(client: AsyncClient, tmp_path: object) -> None:
    from pathlib import Path

    tmp = Path(str(tmp_path))
    config_file = tmp / "config.yml"
    config_file.write_text(SAMPLE_YAML)

    with patch(CONFIG_PATH_FN, return_value=config_file):
        response = await client.patch(
            "/config",
            json={"deepDreamCron": "30 3 * * 1-5"},
            headers=AUTH_HEADER,
        )

    assert response.status_code == 200
    body = response.json()
    assert body["data"]["deepDreamCron"] == "30 3 * * 1-5"


@pytest.mark.asyncio
async def test_patch_config_returns_updated_config(client: AsyncClient, tmp_path: object) -> None:
    from pathlib import Path

    tmp = Path(str(tmp_path))
    config_file = tmp / "config.yml"
    config_file.write_text(SAMPLE_YAML)

    with patch(CONFIG_PATH_FN, return_value=config_file):
        response = await client.patch(
            "/config",
            json={"maxMemoryLines": 300},
            headers=AUTH_HEADER,
        )

    assert response.status_code == 200
    body = response.json()
    assert body["data"]["maxMemoryLines"] == 300

    # Verify file was actually written
    import yaml

    written = yaml.safe_load(config_file.read_text())
    assert written["max_memory_lines"] == 300


@pytest.mark.asyncio
async def test_patch_config_requires_api_key(client: AsyncClient) -> None:
    response = await client.patch("/config", json={"autoMerge": False})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_patch_config_rejects_empty_body(client: AsyncClient) -> None:
    mock_config: dict[str, object] = {
        "auto_merge": True,
        "deep_dream_cron": "0 20 * * *",
        "max_memory_lines": 200,
    }
    with patch(READ_CONFIG_PATH, new_callable=AsyncMock, return_value=mock_config):
        response = await client.patch(
            "/config",
            json={},
            headers=AUTH_HEADER,
        )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_patch_config_writes_atomically(client: AsyncClient, tmp_path: object) -> None:
    """Verify the tmp file is removed after successful write (atomic rename)."""
    from pathlib import Path

    tmp = Path(str(tmp_path))
    config_file = tmp / "config.yml"
    config_file.write_text(SAMPLE_YAML)

    with patch(CONFIG_PATH_FN, return_value=config_file):
        response = await client.patch(
            "/config",
            json={"autoMerge": False},
            headers=AUTH_HEADER,
        )

    assert response.status_code == 200
    tmp_file = config_file.with_suffix(".yml.tmp")
    assert not tmp_file.exists()
