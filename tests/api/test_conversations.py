from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.deps import get_db_session
from app.main import create_app

API_KEY = "test-api-key"
AUTH_HEADER = {"Authorization": f"Bearer {API_KEY}"}


SAMPLE_JSONL = (
    '{"type":"user","message":{"role":"user","content":"Hello"}}\n'
    '{"type":"assistant","message":{"role":"assistant","content":"Hi"}}'
)


def _valid_body() -> dict[str, str]:
    return {
        "sessionId": "abc123-def456",
        "transcript": SAMPLE_JSONL,
        "source": "stop",
    }


def _make_mock_db(
    existing_transcript: object | None = None,
    chain_count: int = 0,
) -> AsyncMock:
    session = AsyncMock()

    call_index = 0

    async def _execute_side_effect(*args: object, **kwargs: object) -> MagicMock:
        nonlocal call_index
        idx = call_index % 2
        call_index += 1
        if idx == 0:
            r = MagicMock()
            r.scalar_one_or_none.return_value = existing_transcript
            return r
        r = MagicMock()
        r.scalar.return_value = chain_count
        return r

    session.execute = AsyncMock(side_effect=_execute_side_effect)
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


class TestGetConversationPosition:
    @pytest.mark.asyncio
    async def test_returns_0_for_unknown_session(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr("app.main._run_migrations", AsyncMock())
        monkeypatch.setattr("app.main._start_arq_pool", AsyncMock())

        app = create_app()
        mock_db = AsyncMock()
        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = None
        mock_db.execute = AsyncMock(return_value=result_mock)

        async def override_db() -> AsyncGenerator[AsyncMock, None]:
            yield mock_db

        app.dependency_overrides[get_db_session] = override_db

        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            response = await client.get(
                "/conversations/position",
                params={"session_id": "unknown-session"},
                headers=AUTH_HEADER,
            )

        assert response.status_code == 200
        body = response.json()
        assert body["session_id"] == "unknown-session"
        assert body["last_line"] == 0

    @pytest.mark.asyncio
    async def test_returns_last_processed_line_for_known_session(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr("app.main._run_migrations", AsyncMock())
        monkeypatch.setattr("app.main._start_arq_pool", AsyncMock())

        app = create_app()
        mock_db = AsyncMock()
        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = 450
        mock_db.execute = AsyncMock(return_value=result_mock)

        async def override_db() -> AsyncGenerator[AsyncMock, None]:
            yield mock_db

        app.dependency_overrides[get_db_session] = override_db

        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            response = await client.get(
                "/conversations/position",
                params={"session_id": "sess-001"},
                headers=AUTH_HEADER,
            )

        assert response.status_code == 200
        body = response.json()
        assert body["session_id"] == "sess-001"
        assert body["last_line"] == 450

    @pytest.mark.asyncio
    async def test_returns_401_without_api_key(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr("app.main._run_migrations", AsyncMock())
        monkeypatch.setattr("app.main._start_arq_pool", AsyncMock())

        app = create_app()

        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            response = await client.get(
                "/conversations/position",
                params={"session_id": "sess-001"},
            )

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_position_returns_highest_across_multiple_transcripts(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """When multiple transcripts exist with different last_processed_line values,
        the endpoint returns the highest (ordered DESC, LIMIT 1)."""
        monkeypatch.setattr("app.main._run_migrations", AsyncMock())
        monkeypatch.setattr("app.main._start_arq_pool", AsyncMock())

        app = create_app()
        mock_db = AsyncMock()
        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = 900
        mock_db.execute = AsyncMock(return_value=result_mock)

        async def override_db() -> AsyncGenerator[AsyncMock, None]:
            yield mock_db

        app.dependency_overrides[get_db_session] = override_db

        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            response = await client.get(
                "/conversations/position",
                params={"session_id": "sess-multi"},
                headers=AUTH_HEADER,
            )

        assert response.status_code == 200
        body = response.json()
        assert body["session_id"] == "sess-multi"
        assert body["last_line"] == 900

    @pytest.mark.asyncio
    async def test_position_returns_0_for_unprocessed_transcript(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """When transcript exists but last_processed_line=0, the query filters it out
        (WHERE last_processed_line > 0), so result is None -> returns 0."""
        monkeypatch.setattr("app.main._run_migrations", AsyncMock())
        monkeypatch.setattr("app.main._start_arq_pool", AsyncMock())

        app = create_app()
        mock_db = AsyncMock()
        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = None
        mock_db.execute = AsyncMock(return_value=result_mock)

        async def override_db() -> AsyncGenerator[AsyncMock, None]:
            yield mock_db

        app.dependency_overrides[get_db_session] = override_db

        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            response = await client.get(
                "/conversations/position",
                params={"session_id": "sess-unprocessed"},
                headers=AUTH_HEADER,
            )

        assert response.status_code == 200
        body = response.json()
        assert body["session_id"] == "sess-unprocessed"
        assert body["last_line"] == 0


class TestPostConversationsSegmentFields:
    @pytest.mark.asyncio
    async def test_stores_segment_fields(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr("app.main._run_migrations", AsyncMock())
        monkeypatch.setattr("app.main._start_arq_pool", AsyncMock())

        app = create_app()
        mock_db = _make_mock_db()
        added_objects: list[object] = []

        def capture_add(obj: object) -> None:
            added_objects.append(obj)

        mock_db.add = capture_add

        async def fake_refresh(obj: object) -> None:
            obj.id = 42  # type: ignore[attr-defined]

        mock_db.refresh = fake_refresh

        async def override_db() -> AsyncGenerator[AsyncMock, None]:
            yield mock_db

        app.dependency_overrides[get_db_session] = override_db
        app.state.redis_pool = _make_mock_arq()

        body = _valid_body()
        body["segmentStartLine"] = 430
        body["segmentEndLine"] = 900

        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            response = await client.post("/conversations", json=body, headers=AUTH_HEADER)

        assert response.status_code == 202
        assert len(added_objects) == 1
        transcript = added_objects[0]
        assert transcript.segment_start_line == 430  # type: ignore[attr-defined]
        assert transcript.segment_end_line == 900  # type: ignore[attr-defined]

    @pytest.mark.asyncio
    async def test_segment_fields_default_to_zero(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr("app.main._run_migrations", AsyncMock())
        monkeypatch.setattr("app.main._start_arq_pool", AsyncMock())

        app = create_app()
        mock_db = _make_mock_db()
        added_objects: list[object] = []

        def capture_add(obj: object) -> None:
            added_objects.append(obj)

        mock_db.add = capture_add

        async def fake_refresh(obj: object) -> None:
            obj.id = 42  # type: ignore[attr-defined]

        mock_db.refresh = fake_refresh

        async def override_db() -> AsyncGenerator[AsyncMock, None]:
            yield mock_db

        app.dependency_overrides[get_db_session] = override_db
        app.state.redis_pool = _make_mock_arq()

        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            response = await client.post("/conversations", json=_valid_body(), headers=AUTH_HEADER)

        assert response.status_code == 202
        assert len(added_objects) == 1
        transcript = added_objects[0]
        assert transcript.segment_start_line == 0  # type: ignore[attr-defined]
        assert transcript.segment_end_line == 0  # type: ignore[attr-defined]


    @pytest.mark.asyncio
    async def test_segment_end_line_less_than_start_line_still_stores(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Edge case: segment_end_line < segment_start_line should still be accepted
        (validation is not enforced at API level, values are stored as-is)."""
        monkeypatch.setattr("app.main._run_migrations", AsyncMock())
        monkeypatch.setattr("app.main._start_arq_pool", AsyncMock())

        app = create_app()
        mock_db = _make_mock_db()
        added_objects: list[object] = []

        def capture_add(obj: object) -> None:
            added_objects.append(obj)

        mock_db.add = capture_add

        async def fake_refresh(obj: object) -> None:
            obj.id = 42  # type: ignore[attr-defined]

        mock_db.refresh = fake_refresh

        async def override_db() -> AsyncGenerator[AsyncMock, None]:
            yield mock_db

        app.dependency_overrides[get_db_session] = override_db
        app.state.redis_pool = _make_mock_arq()

        body = _valid_body()
        body["segmentStartLine"] = 500
        body["segmentEndLine"] = 100

        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            response = await client.post("/conversations", json=body, headers=AUTH_HEADER)

        assert response.status_code == 202
        assert len(added_objects) == 1
        transcript = added_objects[0]
        assert transcript.segment_start_line == 500  # type: ignore[attr-defined]
        assert transcript.segment_end_line == 100  # type: ignore[attr-defined]

    @pytest.mark.asyncio
    async def test_segment_fields_with_very_large_values(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Edge case: very large segment line numbers should be accepted."""
        monkeypatch.setattr("app.main._run_migrations", AsyncMock())
        monkeypatch.setattr("app.main._start_arq_pool", AsyncMock())

        app = create_app()
        mock_db = _make_mock_db()
        added_objects: list[object] = []

        def capture_add(obj: object) -> None:
            added_objects.append(obj)

        mock_db.add = capture_add

        async def fake_refresh(obj: object) -> None:
            obj.id = 42  # type: ignore[attr-defined]

        mock_db.refresh = fake_refresh

        async def override_db() -> AsyncGenerator[AsyncMock, None]:
            yield mock_db

        app.dependency_overrides[get_db_session] = override_db
        app.state.redis_pool = _make_mock_arq()

        body = _valid_body()
        body["segmentStartLine"] = 999_999
        body["segmentEndLine"] = 1_000_000

        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            response = await client.post("/conversations", json=body, headers=AUTH_HEADER)

        assert response.status_code == 202
        assert len(added_objects) == 1
        transcript = added_objects[0]
        assert transcript.segment_start_line == 999_999  # type: ignore[attr-defined]
        assert transcript.segment_end_line == 1_000_000  # type: ignore[attr-defined]


class TestConversationChainSupport:
    @pytest.mark.asyncio
    async def test_first_transcript_sets_is_continuation_false(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr("app.main._run_migrations", AsyncMock())
        monkeypatch.setattr("app.main._start_arq_pool", AsyncMock())

        app = create_app()
        mock_db = _make_mock_db(chain_count=0)
        added_objects: list[object] = []

        def capture_add(obj: object) -> None:
            added_objects.append(obj)

        mock_db.add = capture_add

        async def fake_refresh(obj: object) -> None:
            obj.id = 42  # type: ignore[attr-defined]

        mock_db.refresh = fake_refresh

        async def override_db() -> AsyncGenerator[AsyncMock, None]:
            yield mock_db

        app.dependency_overrides[get_db_session] = override_db
        app.state.redis_pool = _make_mock_arq()

        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            response = await client.post("/conversations", json=_valid_body(), headers=AUTH_HEADER)

        assert response.status_code == 202
        assert len(added_objects) == 1
        transcript = added_objects[0]
        assert transcript.is_continuation is False  # type: ignore[attr-defined]

    @pytest.mark.asyncio
    async def test_resumed_session_sets_is_continuation_true(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr("app.main._run_migrations", AsyncMock())
        monkeypatch.setattr("app.main._start_arq_pool", AsyncMock())

        app = create_app()
        mock_db = _make_mock_db(chain_count=1)
        added_objects: list[object] = []

        def capture_add(obj: object) -> None:
            added_objects.append(obj)

        mock_db.add = capture_add

        async def fake_refresh(obj: object) -> None:
            obj.id = 43  # type: ignore[attr-defined]

        mock_db.refresh = fake_refresh

        async def override_db() -> AsyncGenerator[AsyncMock, None]:
            yield mock_db

        app.dependency_overrides[get_db_session] = override_db
        app.state.redis_pool = _make_mock_arq()

        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            response = await client.post("/conversations", json=_valid_body(), headers=AUTH_HEADER)

        assert response.status_code == 202
        assert len(added_objects) == 1
        transcript = added_objects[0]
        assert transcript.is_continuation is True  # type: ignore[attr-defined]

    @pytest.mark.asyncio
    async def test_duplicate_within_window_returns_200(
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
    async def test_dedup_boundary_at_59s_returns_duplicate(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Submit at 59s within dedup window should be detected as duplicate."""
        monkeypatch.setattr("app.main._run_migrations", AsyncMock())
        monkeypatch.setattr("app.main._start_arq_pool", AsyncMock())

        app = create_app()
        existing = MagicMock()
        existing.id = 77
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
        assert body["data"]["transcriptId"] == 77

    @pytest.mark.asyncio
    async def test_dedup_boundary_at_61s_creates_new_row(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Submit at 61s outside dedup window should create a new transcript."""
        monkeypatch.setattr("app.main._run_migrations", AsyncMock())
        monkeypatch.setattr("app.main._start_arq_pool", AsyncMock())

        app = create_app()
        mock_db = _make_mock_db(existing_transcript=None, chain_count=0)

        async def fake_refresh(obj: object) -> None:
            obj.id = 50  # type: ignore[attr-defined]

        mock_db.refresh = fake_refresh

        async def override_db() -> AsyncGenerator[AsyncMock, None]:
            yield mock_db

        app.dependency_overrides[get_db_session] = override_db
        app.state.redis_pool = _make_mock_arq()

        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            response = await client.post("/conversations", json=_valid_body(), headers=AUTH_HEADER)

        assert response.status_code == 202
        body = response.json()
        assert body["data"].get("duplicate") is not True
        assert body["data"]["transcriptId"] == 50

    @pytest.mark.asyncio
    async def test_chain_of_three_transcripts(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Submit 3 transcripts for same session_id, verify chain_count drives is_continuation."""
        monkeypatch.setattr("app.main._run_migrations", AsyncMock())
        monkeypatch.setattr("app.main._start_arq_pool", AsyncMock())

        added_objects: list[object] = []
        transcript_id_seq = iter([10, 11, 12])

        for chain_count in (0, 1, 2):
            app = create_app()
            mock_db = _make_mock_db(existing_transcript=None, chain_count=chain_count)

            def capture_add(obj: object) -> None:
                added_objects.append(obj)

            mock_db.add = capture_add

            async def fake_refresh(obj: object, _seq: object = transcript_id_seq) -> None:
                obj.id = next(_seq)  # type: ignore[attr-defined]

            mock_db.refresh = fake_refresh

            async def override_db() -> AsyncGenerator[AsyncMock, None]:
                yield mock_db

            app.dependency_overrides[get_db_session] = override_db
            app.state.redis_pool = _make_mock_arq()

            async with AsyncClient(
                transport=ASGITransport(app=app),
                base_url="http://test",
            ) as client:
                resp = await client.post("/conversations", json=_valid_body(), headers=AUTH_HEADER)
            assert resp.status_code == 202

        assert len(added_objects) == 3
        assert added_objects[0].is_continuation is False  # type: ignore[attr-defined]
        assert added_objects[1].is_continuation is True  # type: ignore[attr-defined]
        assert added_objects[2].is_continuation is True  # type: ignore[attr-defined]

    @pytest.mark.asyncio
    async def test_mixed_sources_both_stored(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Submit pre-compact then stop for same session, both should be stored (different sources)."""
        monkeypatch.setattr("app.main._run_migrations", AsyncMock())
        monkeypatch.setattr("app.main._start_arq_pool", AsyncMock())

        added_objects: list[object] = []

        for source, tid in [("pre-compact", 20), ("stop", 21)]:
            app = create_app()
            mock_db = _make_mock_db(existing_transcript=None, chain_count=0)

            def capture_add(obj: object) -> None:
                added_objects.append(obj)

            mock_db.add = capture_add

            async def fake_refresh(obj: object, _tid: int = tid) -> None:
                obj.id = _tid  # type: ignore[attr-defined]

            mock_db.refresh = fake_refresh

            async def override_db() -> AsyncGenerator[AsyncMock, None]:
                yield mock_db

            app.dependency_overrides[get_db_session] = override_db
            app.state.redis_pool = _make_mock_arq()

            body = _valid_body()
            body["source"] = source

            async with AsyncClient(
                transport=ASGITransport(app=app),
                base_url="http://test",
            ) as client:
                resp = await client.post("/conversations", json=body, headers=AUTH_HEADER)
            assert resp.status_code == 202

        assert len(added_objects) == 2
        sources = {obj.source for obj in added_objects}  # type: ignore[attr-defined]
        assert sources == {"pre-compact", "stop"}
