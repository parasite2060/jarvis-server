from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from app.core.exceptions import MemuError, MemuUnavailableError

API_KEY = "test-api-key"
AUTH_HEADER = {"Authorization": f"Bearer {API_KEY}"}

MEMU_RETRIEVE_PATH = "app.api.routes.memory.memu_retrieve"
MEMU_MEMORIZE_PATH = "app.api.routes.memory.memu_memorize"


# --- POST /memory/search tests ---


@pytest.mark.asyncio
async def test_memory_search_returns_200_with_results(client: AsyncClient) -> None:
    memu_response = {
        "memories": [
            {
                "content": "NestJS is the framework",
                "relevance": 0.95,
                "source": "session-1",
                "metadata": {"key": "val"},
            },
            {"content": "FastAPI is used too", "relevance": 0.8},
        ],
        "status": "success",
    }

    with patch(MEMU_RETRIEVE_PATH, new_callable=AsyncMock, return_value=memu_response):
        response = await client.post(
            "/memory/search",
            json={"query": "What framework?", "method": "rag"},
            headers=AUTH_HEADER,
        )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert len(body["data"]["results"]) == 2
    assert body["data"]["query"] == "What framework?"
    assert body["data"]["method"] == "rag"


@pytest.mark.asyncio
async def test_memory_search_transforms_memu_response(client: AsyncClient) -> None:
    memu_response = {
        "memories": [
            {
                "content": "test content",
                "relevance": 0.9,
                "source": "src-1",
                "metadata": {"tag": "test"},
            },
        ],
        "status": "success",
    }

    with patch(MEMU_RETRIEVE_PATH, new_callable=AsyncMock, return_value=memu_response):
        response = await client.post(
            "/memory/search",
            json={"query": "test"},
            headers=AUTH_HEADER,
        )

    body = response.json()
    result = body["data"]["results"][0]
    assert result["content"] == "test content"
    assert result["relevance"] == 0.9
    assert result["source"] == "src-1"
    assert result["metadata"] == {"tag": "test"}


@pytest.mark.asyncio
async def test_memory_search_returns_error_on_memu_error(client: AsyncClient) -> None:
    with patch(
        MEMU_RETRIEVE_PATH, new_callable=AsyncMock, side_effect=MemuError(422, "Validation failed")
    ):
        response = await client.post(
            "/memory/search",
            json={"query": "test"},
            headers=AUTH_HEADER,
        )

    assert response.status_code == 422
    body = response.json()
    assert body["status"] == "error"
    assert body["error"]["code"] == "MEMU_ERROR"
    assert body["error"]["message"] == "Validation failed"


@pytest.mark.asyncio
async def test_memory_search_returns_502_when_memu_unreachable(client: AsyncClient) -> None:
    with patch(
        MEMU_RETRIEVE_PATH,
        new_callable=AsyncMock,
        side_effect=MemuUnavailableError("Connection refused"),
    ):
        response = await client.post(
            "/memory/search",
            json={"query": "test"},
            headers=AUTH_HEADER,
        )

    assert response.status_code == 502
    body = response.json()
    assert body["status"] == "error"
    assert body["error"]["code"] == "MEMU_UNAVAILABLE"


@pytest.mark.asyncio
async def test_memory_search_returns_401_without_api_key(client: AsyncClient) -> None:
    response = await client.post("/memory/search", json={"query": "test"})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_memory_search_returns_422_for_missing_fields(client: AsyncClient) -> None:
    response = await client.post(
        "/memory/search",
        json={},
        headers=AUTH_HEADER,
    )
    assert response.status_code == 422


# --- POST /memory/add tests ---


@pytest.mark.asyncio
async def test_memory_add_returns_200_with_memory_id(client: AsyncClient) -> None:
    memu_response = {"task_id": "uuid-abc-123", "status": "accepted"}

    with patch(MEMU_MEMORIZE_PATH, new_callable=AsyncMock, return_value=memu_response):
        response = await client.post(
            "/memory/add",
            json={"content": "I chose NestJS for the backend"},
            headers=AUTH_HEADER,
        )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["data"]["memoryId"] == "uuid-abc-123"
    assert body["data"]["status"] == "accepted"


@pytest.mark.asyncio
async def test_memory_add_converts_content_to_messages(client: AsyncClient) -> None:
    memu_response = {"task_id": "uuid-1", "status": "accepted"}

    with patch(
        MEMU_MEMORIZE_PATH, new_callable=AsyncMock, return_value=memu_response
    ) as mock_memorize:
        await client.post(
            "/memory/add",
            json={"content": "Test content"},
            headers=AUTH_HEADER,
        )

    mock_memorize.assert_called_once_with([{"role": "user", "content": "Test content"}])


@pytest.mark.asyncio
async def test_memory_add_includes_context_as_message(client: AsyncClient) -> None:
    memu_response = {"task_id": "uuid-2", "status": "accepted"}

    with patch(
        MEMU_MEMORIZE_PATH, new_callable=AsyncMock, return_value=memu_response
    ) as mock_memorize:
        await client.post(
            "/memory/add",
            json={"content": "I chose NestJS", "metadata": {"context": "Architecture discussion"}},
            headers=AUTH_HEADER,
        )

    mock_memorize.assert_called_once_with(
        [
            {"role": "system", "content": "Architecture discussion"},
            {"role": "user", "content": "I chose NestJS"},
        ]
    )


@pytest.mark.asyncio
async def test_memory_add_returns_error_on_memu_error(client: AsyncClient) -> None:
    with patch(
        MEMU_MEMORIZE_PATH, new_callable=AsyncMock, side_effect=MemuError(500, "Internal error")
    ):
        response = await client.post(
            "/memory/add",
            json={"content": "test"},
            headers=AUTH_HEADER,
        )

    assert response.status_code == 500
    body = response.json()
    assert body["status"] == "error"
    assert body["error"]["code"] == "MEMU_ERROR"


@pytest.mark.asyncio
async def test_memory_add_returns_502_when_memu_unreachable(client: AsyncClient) -> None:
    with patch(MEMU_MEMORIZE_PATH, new_callable=AsyncMock, side_effect=MemuUnavailableError()):
        response = await client.post(
            "/memory/add",
            json={"content": "test"},
            headers=AUTH_HEADER,
        )

    assert response.status_code == 502
    body = response.json()
    assert body["status"] == "error"
    assert body["error"]["code"] == "MEMU_UNAVAILABLE"


@pytest.mark.asyncio
async def test_memory_add_returns_401_without_api_key(client: AsyncClient) -> None:
    response = await client.post("/memory/add", json={"content": "test"})
    assert response.status_code == 401
