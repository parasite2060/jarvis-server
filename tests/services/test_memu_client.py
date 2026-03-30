import json as json_mod
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.core.exceptions import MemuError, MemuUnavailableError
from app.services import memu_client
from app.services.memu_client import memu_memorize, memu_retrieve


@pytest.fixture(autouse=True)
def _reset_client() -> None:
    memu_client._client = None


def _make_response(
    status_code: int = 200, json_data: dict | None = None, text: str = ""
) -> httpx.Response:
    if json_data is not None:
        return httpx.Response(
            status_code=status_code,
            content=json_mod.dumps(json_data).encode(),
            headers={"content-type": "application/json"},
            request=httpx.Request("POST", "http://test"),
        )
    return httpx.Response(
        status_code=status_code,
        text=text,
        request=httpx.Request("POST", "http://test"),
    )


# --- memu_retrieve tests ---


@pytest.mark.asyncio
async def test_memu_retrieve_makes_correct_post() -> None:
    mock_response = _make_response(
        json_data={"memories": [{"content": "test", "relevance": 0.9}], "status": "success"}
    )
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.post = AsyncMock(return_value=mock_response)

    with patch.object(memu_client, "_get_client", return_value=mock_client):
        await memu_retrieve("What framework?", "rag")

    mock_client.post.assert_called_once_with(
        "/api/v3/memory/retrieve",
        json={"query": "What framework?", "method": "rag"},
    )


@pytest.mark.asyncio
async def test_memu_retrieve_returns_parsed_json() -> None:
    expected = {"memories": [{"content": "NestJS", "relevance": 0.95}], "status": "success"}
    mock_response = _make_response(json_data=expected)
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.post = AsyncMock(return_value=mock_response)

    with patch.object(memu_client, "_get_client", return_value=mock_client):
        result = await memu_retrieve("test query")

    assert result == expected


@pytest.mark.asyncio
async def test_memu_retrieve_raises_memu_error_on_4xx() -> None:
    error_response = _make_response(status_code=422, text="Validation error")
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.post = AsyncMock(return_value=error_response)

    with patch.object(memu_client, "_get_client", return_value=mock_client):
        with pytest.raises(MemuError) as exc_info:
            await memu_retrieve("bad query")

    assert exc_info.value.status_code == 422


@pytest.mark.asyncio
async def test_memu_retrieve_raises_memu_error_on_5xx() -> None:
    error_response = _make_response(status_code=500, text="Internal error")
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.post = AsyncMock(return_value=error_response)

    with patch.object(memu_client, "_get_client", return_value=mock_client):
        with pytest.raises(MemuError) as exc_info:
            await memu_retrieve("query")

    assert exc_info.value.status_code == 500


@pytest.mark.asyncio
async def test_memu_retrieve_raises_unavailable_on_connect_error() -> None:
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.post = AsyncMock(side_effect=httpx.ConnectError("Connection refused"))

    with patch.object(memu_client, "_get_client", return_value=mock_client):
        with pytest.raises(MemuUnavailableError):
            await memu_retrieve("query")


@pytest.mark.asyncio
async def test_memu_retrieve_raises_unavailable_on_timeout() -> None:
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.post = AsyncMock(side_effect=httpx.TimeoutException("Timeout"))

    with patch.object(memu_client, "_get_client", return_value=mock_client):
        with pytest.raises(MemuUnavailableError):
            await memu_retrieve("query")


# --- memu_memorize tests ---


@pytest.mark.asyncio
async def test_memu_memorize_makes_correct_post() -> None:
    messages = [{"role": "user", "content": "I chose NestJS"}]
    mock_response = _make_response(json_data={"task_id": "abc-123", "status": "accepted"})
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.post = AsyncMock(return_value=mock_response)

    with patch.object(memu_client, "_get_client", return_value=mock_client):
        await memu_memorize(messages)

    mock_client.post.assert_called_once_with(
        "/api/v3/memory/memorize",
        json={"messages": messages},
    )


@pytest.mark.asyncio
async def test_memu_memorize_returns_parsed_json() -> None:
    expected = {"task_id": "abc-123", "status": "accepted"}
    mock_response = _make_response(json_data=expected)
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.post = AsyncMock(return_value=mock_response)

    with patch.object(memu_client, "_get_client", return_value=mock_client):
        result = await memu_memorize([{"role": "user", "content": "test"}])

    assert result == expected


@pytest.mark.asyncio
async def test_memu_memorize_raises_memu_error_on_error_response() -> None:
    error_response = _make_response(status_code=400, text="Bad request")
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.post = AsyncMock(return_value=error_response)

    with patch.object(memu_client, "_get_client", return_value=mock_client):
        with pytest.raises(MemuError) as exc_info:
            await memu_memorize([{"role": "user", "content": "test"}])

    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_memu_memorize_raises_unavailable_on_timeout() -> None:
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.post = AsyncMock(side_effect=httpx.TimeoutException("Timeout"))

    with patch.object(memu_client, "_get_client", return_value=mock_client):
        with pytest.raises(MemuUnavailableError):
            await memu_memorize([{"role": "user", "content": "test"}])
