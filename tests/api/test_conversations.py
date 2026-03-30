from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.deps import get_db_session
from app.main import create_app

API_KEY = "test-api-key"
AUTH_HEADER = {"Authorization": f"Bearer {API_KEY}"}


SAMPLE_JSONL = (
    '{"type":"human","message":{"role":"user","content":"Hello"}}\n'
    '{"type":"assistant","message":{"role":"assistant","content":"Hi"}}'
)


def _valid_body() -> dict[str, str]:
    return {
        "sessionId": "abc123-def456",
        "transcript": SAMPLE_JSONL,
        "source": "stop",
    }


def _make_mock_db(existing_transcript: object | None = None) -> AsyncMock:
    session = AsyncMock()
    result_mock = MagicMock()
    result_mock.scalar_one_or_none.return_value = existing_transcript
    session.execute.return_value = result_mock
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    return session


def _make_mock_arq() -> AsyncMock:
    pool = AsyncMock()
    pool.enqueue_job = AsyncMock(return_value=AsyncMock(job_id="test-job-id"))
    return pool


@pytest.fixture
async def conversation_client(
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncGenerator[tuple[AsyncClient, AsyncMock, AsyncMock], None]:
    monkeypatch.setattr("app.main._run_migrations", AsyncMock())
    monkeypatch.setattr("app.main._start_arq_pool", AsyncMock())

    app = create_app()
    mock_db = _make_mock_db()
    mock_arq = _make_mock_arq()

    async def fake_refresh(obj: object) -> None:
        obj.id = 42  # type: ignore[attr-defined]

    mock_db.refresh = fake_refresh

    async def override_db() -> AsyncGenerator[AsyncMock, None]:
        yield mock_db

    app.dependency_overrides[get_db_session] = override_db
    app.state.redis_pool = mock_arq

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac, mock_db, mock_arq


class TestPostConversations:
    @pytest.mark.asyncio
    async def test_returns_202_with_transcript_id(
        self,
        conversation_client: tuple[AsyncClient, AsyncMock, AsyncMock],
    ) -> None:
        client, _, _ = conversation_client
        response = await client.post("/conversations", json=_valid_body(), headers=AUTH_HEADER)

        assert response.status_code == 202
        body = response.json()
        assert body["status"] == "ok"
        assert body["data"]["transcriptId"] == 42

    @pytest.mark.asyncio
    async def test_stores_raw_content_and_parsed_text(
        self,
        conversation_client: tuple[AsyncClient, AsyncMock, AsyncMock],
    ) -> None:
        client, mock_db, _ = conversation_client
        added_objects: list[object] = []

        def capture_add(obj: object) -> None:
            added_objects.append(obj)

        mock_db.add = capture_add

        await client.post("/conversations", json=_valid_body(), headers=AUTH_HEADER)

        assert len(added_objects) == 1
        transcript = added_objects[0]
        assert transcript.raw_content == _valid_body()["transcript"]  # type: ignore[attr-defined]
        assert "User: Hello" in transcript.parsed_text  # type: ignore[attr-defined]
        assert "Assistant: Hi" in transcript.parsed_text  # type: ignore[attr-defined]

    @pytest.mark.asyncio
    async def test_returns_200_for_duplicate(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr("app.main._run_migrations", AsyncMock())
        monkeypatch.setattr("app.main._start_arq_pool", AsyncMock())

        app = create_app()
        existing = MagicMock()
        existing.id = 99
        mock_db = _make_mock_db(existing_transcript=existing)

        async def override_db() -> AsyncGenerator[AsyncMock, None]:
            yield mock_db

        app.dependency_overrides[get_db_session] = override_db
        app.state.redis_pool = _make_mock_arq()

        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            response = await client.post("/conversations", json=_valid_body(), headers=AUTH_HEADER)

        assert response.status_code == 200
        body = response.json()
        assert body["data"]["duplicate"] is True
        assert body["data"]["transcriptId"] == 99

    @pytest.mark.asyncio
    async def test_allows_same_session_id_different_source(
        self,
        conversation_client: tuple[AsyncClient, AsyncMock, AsyncMock],
    ) -> None:
        client, _, _ = conversation_client
        body1 = _valid_body()
        body1["source"] = "stop"
        resp1 = await client.post("/conversations", json=body1, headers=AUTH_HEADER)

        body2 = _valid_body()
        body2["source"] = "pre-compact"
        resp2 = await client.post("/conversations", json=body2, headers=AUTH_HEADER)

        assert resp1.status_code == 202
        assert resp2.status_code == 202

    @pytest.mark.asyncio
    async def test_returns_401_without_api_key(
        self,
        conversation_client: tuple[AsyncClient, AsyncMock, AsyncMock],
    ) -> None:
        client, _, _ = conversation_client
        response = await client.post("/conversations", json=_valid_body())

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_returns_422_for_missing_fields(
        self,
        conversation_client: tuple[AsyncClient, AsyncMock, AsyncMock],
    ) -> None:
        client, _, _ = conversation_client
        response = await client.post(
            "/conversations", json={"sessionId": "abc"}, headers=AUTH_HEADER
        )

        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_arq_task_enqueued(
        self,
        conversation_client: tuple[AsyncClient, AsyncMock, AsyncMock],
    ) -> None:
        client, _, mock_arq = conversation_client
        await client.post("/conversations", json=_valid_body(), headers=AUTH_HEADER)

        mock_arq.enqueue_job.assert_called_once_with("light_dream_task", transcript_id=42)

    @pytest.mark.asyncio
    async def test_returns_202_when_arq_enqueue_fails(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr("app.main._run_migrations", AsyncMock())
        monkeypatch.setattr("app.main._start_arq_pool", AsyncMock())

        app = create_app()
        mock_db = _make_mock_db()

        async def fake_refresh(obj: object) -> None:
            obj.id = 5  # type: ignore[attr-defined]

        mock_db.refresh = fake_refresh
        mock_arq = AsyncMock()
        mock_arq.enqueue_job = AsyncMock(side_effect=ConnectionError("Redis down"))

        async def override_db() -> AsyncGenerator[AsyncMock, None]:
            yield mock_db

        app.dependency_overrides[get_db_session] = override_db
        app.state.redis_pool = mock_arq

        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            response = await client.post("/conversations", json=_valid_body(), headers=AUTH_HEADER)

        assert response.status_code == 202
        body = response.json()
        assert body["data"]["transcriptId"] == 5
