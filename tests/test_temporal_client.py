import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.fixture(autouse=True)
async def reset_client_state() -> None:
    import app.temporal_client as tc

    tc._client = None
    yield
    tc._client = None


async def test_get_temporal_client_connects_once_on_concurrent_calls() -> None:
    mock_client = MagicMock()
    connect_mock = AsyncMock(return_value=mock_client)

    from app.temporal_client import get_temporal_client

    with patch("app.temporal_client.Client.connect", connect_mock):
        results = await asyncio.gather(*[get_temporal_client() for _ in range(5)])

    assert connect_mock.await_count == 1
    assert all(r is mock_client for r in results)


async def test_get_temporal_client_reconnects_after_close() -> None:
    from app.temporal_client import close_temporal_client, get_temporal_client

    mock_client = MagicMock()
    connect_mock = AsyncMock(return_value=mock_client)

    with patch("app.temporal_client.Client.connect", connect_mock):
        first = await get_temporal_client()
        await close_temporal_client()
        second = await get_temporal_client()

    assert connect_mock.await_count == 2
    assert first is mock_client
    assert second is mock_client


async def test_close_temporal_client_is_noop_when_no_client() -> None:
    from app.temporal_client import close_temporal_client

    await close_temporal_client()
