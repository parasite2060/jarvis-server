from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient

API_KEY = "test-api-key"
AUTH_HEADER = {"Authorization": f"Bearer {API_KEY}"}


def _make_mock_arq() -> AsyncMock:
    pool = AsyncMock()
    pool.enqueue_job = AsyncMock(return_value=AsyncMock(job_id="test-job-id"))
    return pool


@pytest.fixture
async def dream_client(
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncGenerator[tuple[AsyncClient, AsyncMock], None]:
    monkeypatch.setattr("app.main._run_migrations", AsyncMock())
    monkeypatch.setattr("app.main._start_arq_pool", AsyncMock())
    monkeypatch.setattr("app.main._start_dream_scheduler", AsyncMock())
    monkeypatch.setattr("app.main._vault_sync_loop", AsyncMock())

    from app.main import create_app

    app = create_app()
    mock_arq = _make_mock_arq()
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
    client, mock_arq = dream_client

    response = await client.post("/dream", headers=AUTH_HEADER)

    assert response.status_code == 202
    assert response.json() == {"data": {"status": "queued"}, "status": "ok"}
    mock_arq.enqueue_job.assert_awaited_once_with(
        "deep_dream_task",
        trigger="manual",
        source_date_iso=None,
    )


@pytest.mark.asyncio
async def test_dream_with_source_date(
    dream_client: tuple[AsyncClient, AsyncMock],
) -> None:
    client, mock_arq = dream_client

    response = await client.post(
        "/dream",
        json={"source_date": "2026-04-20"},
        headers=AUTH_HEADER,
    )

    assert response.status_code == 202
    assert response.json() == {"data": {"status": "queued"}, "status": "ok"}
    mock_arq.enqueue_job.assert_awaited_once_with(
        "deep_dream_task",
        trigger="manual-backfill",
        source_date_iso="2026-04-20",
    )


@pytest.mark.asyncio
async def test_dream_invalid_source_date(
    dream_client: tuple[AsyncClient, AsyncMock],
) -> None:
    client, mock_arq = dream_client

    response = await client.post(
        "/dream",
        json={"source_date": "not-a-date"},
        headers=AUTH_HEADER,
    )

    assert response.status_code == 422
    mock_arq.enqueue_job.assert_not_awaited()


@pytest.mark.asyncio
async def test_dream_empty_json_body(
    dream_client: tuple[AsyncClient, AsyncMock],
) -> None:
    client, mock_arq = dream_client

    response = await client.post("/dream", json={}, headers=AUTH_HEADER)

    assert response.status_code == 202
    mock_arq.enqueue_job.assert_awaited_once_with(
        "deep_dream_task",
        trigger="manual",
        source_date_iso=None,
    )


@pytest.mark.asyncio
async def test_dream_future_date_accepted(
    dream_client: tuple[AsyncClient, AsyncMock],
) -> None:
    client, mock_arq = dream_client

    response = await client.post(
        "/dream",
        json={"source_date": "2099-01-01"},
        headers=AUTH_HEADER,
    )

    assert response.status_code == 202
    mock_arq.enqueue_job.assert_awaited_once_with(
        "deep_dream_task",
        trigger="manual-backfill",
        source_date_iso="2099-01-01",
    )


@pytest.mark.asyncio
async def test_dream_returns_401_without_auth(
    dream_client: tuple[AsyncClient, AsyncMock],
) -> None:
    client, _ = dream_client

    response = await client.post("/dream")

    assert response.status_code == 401
