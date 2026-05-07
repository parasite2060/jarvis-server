from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

API_KEY = "test-api-key"
AUTH_HEADER = {"Authorization": f"Bearer {API_KEY}"}


@pytest.fixture
async def dream_client(
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncGenerator[tuple[AsyncClient, AsyncMock], None]:
    monkeypatch.setattr("app.main._run_migrations", AsyncMock())
    monkeypatch.setattr("app.main._vault_sync_loop", AsyncMock())

    from app.main import create_app

    app = create_app()
    # Keep ARQ pool mock for coexistence (not used by /dream route anymore)
    mock_arq = AsyncMock()
    app.state.redis_pool = mock_arq

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac, mock_arq


@pytest.mark.asyncio
async def test_dream_no_body_still_works(
    dream_client: tuple[AsyncClient, AsyncMock],
) -> None:
    client, _ = dream_client

    with patch("app.api.routes.dream.signal_coordinator", new_callable=AsyncMock) as mock_signal:
        response = await client.post("/dream", headers=AUTH_HEADER)

    assert response.status_code == 202
    assert response.json() == {"data": {"status": "queued"}, "status": "ok"}
    mock_signal.assert_awaited_once()
    call_args = mock_signal.call_args
    assert call_args[0][0] == "deep"
    payload = call_args[0][1]
    assert payload["trigger"] == "manual"
    assert payload["source_date_iso"] is None
    assert "target_date" in payload


@pytest.mark.asyncio
async def test_dream_with_source_date(
    dream_client: tuple[AsyncClient, AsyncMock],
) -> None:
    client, _ = dream_client

    with patch("app.api.routes.dream.signal_coordinator", new_callable=AsyncMock) as mock_signal:
        response = await client.post(
            "/dream",
            json={"source_date": "2026-04-20"},
            headers=AUTH_HEADER,
        )

    assert response.status_code == 202
    assert response.json() == {"data": {"status": "queued"}, "status": "ok"}
    mock_signal.assert_awaited_once()
    call_args = mock_signal.call_args
    assert call_args[0][0] == "deep"
    payload = call_args[0][1]
    assert payload["trigger"] == "manual-backfill"
    assert payload["source_date_iso"] == "2026-04-20"
    assert payload["target_date"] == "2026-04-20"


@pytest.mark.asyncio
async def test_dream_invalid_source_date(
    dream_client: tuple[AsyncClient, AsyncMock],
) -> None:
    client, _ = dream_client

    with patch("app.api.routes.dream.signal_coordinator", new_callable=AsyncMock) as mock_signal:
        response = await client.post(
            "/dream",
            json={"source_date": "not-a-date"},
            headers=AUTH_HEADER,
        )

    assert response.status_code == 422
    mock_signal.assert_not_awaited()


@pytest.mark.asyncio
async def test_dream_empty_json_body(
    dream_client: tuple[AsyncClient, AsyncMock],
) -> None:
    client, _ = dream_client

    with patch("app.api.routes.dream.signal_coordinator", new_callable=AsyncMock) as mock_signal:
        response = await client.post("/dream", json={}, headers=AUTH_HEADER)

    assert response.status_code == 202
    mock_signal.assert_awaited_once()
    payload = mock_signal.call_args[0][1]
    assert payload["trigger"] == "manual"
    assert payload["source_date_iso"] is None


@pytest.mark.asyncio
async def test_dream_future_date_accepted(
    dream_client: tuple[AsyncClient, AsyncMock],
) -> None:
    client, _ = dream_client

    with patch("app.api.routes.dream.signal_coordinator", new_callable=AsyncMock) as mock_signal:
        response = await client.post(
            "/dream",
            json={"source_date": "2099-01-01"},
            headers=AUTH_HEADER,
        )

    assert response.status_code == 202
    mock_signal.assert_awaited_once()
    payload = mock_signal.call_args[0][1]
    assert payload["trigger"] == "manual-backfill"
    assert payload["source_date_iso"] == "2099-01-01"
    assert payload["target_date"] == "2099-01-01"


@pytest.mark.asyncio
async def test_dream_returns_401_without_auth(
    dream_client: tuple[AsyncClient, AsyncMock],
) -> None:
    client, _ = dream_client

    response = await client.post("/dream")

    assert response.status_code == 401
