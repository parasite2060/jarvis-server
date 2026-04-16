"""E2E integration tests for the full conversation chain + incremental transcript pipeline.

Pipeline under test:
1. POST /conversations → stored in DB → light_dream_task queued
2. light_dream_task completes → last_processed_line updated
3. Second POST (same session_id) → new row with is_continuation=true → queued
4. Subsequent light_dream_task → processes only new segment

Uses mocked DB sessions (no real PostgreSQL required).
"""

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


def _body(
    session_id: str,
    source: str = "stop",
    segment_start_line: int = 0,
    segment_end_line: int = 0,
) -> dict:
    payload: dict = {
        "sessionId": session_id,
        "transcript": SAMPLE_JSONL,
        "source": source,
    }
    if segment_start_line:
        payload["segmentStartLine"] = segment_start_line
    if segment_end_line:
        payload["segmentEndLine"] = segment_end_line
    return payload


class FakeSession:
    """Tracks DB state across multiple calls for multi-step pipeline tests.

    Stores added transcripts in a list and resolves dedup / chain-count /
    position queries from that state.
    """

    def __init__(self) -> None:
        self.transcripts: list[MagicMock] = []
        self._next_id = 1

    def _find_dedup(self, session_id: str, source: str) -> MagicMock | None:
        for t in reversed(self.transcripts):
            if t.session_id == session_id and t.source == source and t._dedup_active:
                return t
        return None

    def _chain_count(self, session_id: str) -> int:
        return sum(1 for t in self.transcripts if t.session_id == session_id)

    def _last_processed_line(self, session_id: str) -> int | None:
        best = 0
        for t in self.transcripts:
            if t.session_id == session_id and t.last_processed_line > 0:
                if t.last_processed_line > best:
                    best = t.last_processed_line
        return best if best > 0 else None

    def build_mock(self, *, dedup_active: bool = True) -> AsyncMock:
        """Return an AsyncMock that behaves like an AsyncSession."""
        session = AsyncMock()
        fake = self
        call_counter = {"n": 0}

        async def _execute(stmt, *args, **kwargs):  # noqa: ANN001, ANN003, ANN002
            call_counter["n"] += 1
            r = MagicMock()

            stmt_str = str(stmt)

            if "last_processed_line" in stmt_str and "ORDER BY" in stmt_str:
                session_id = _extract_session_id_from_position_calls(stmt)
                val = fake._last_processed_line(session_id)
                r.scalar_one_or_none.return_value = val
                return r

            idx = call_counter["n"]
            if idx % 2 == 1:
                session_id = _extract_session_id_from_calls(stmt)
                existing = fake._find_dedup(session_id, _extract_source_from_calls(stmt)) if dedup_active else None
                r.scalar_one_or_none.return_value = existing
                return r
            else:
                session_id = _extract_session_id_from_calls(stmt)
                r.scalar.return_value = fake._chain_count(session_id)
                return r

        def _add(obj):  # noqa: ANN001
            obj.id = fake._next_id
            obj._dedup_active = dedup_active
            fake._next_id += 1
            fake.transcripts.append(obj)

        async def _refresh(obj):  # noqa: ANN001
            pass

        async def _commit():
            pass

        session.execute = AsyncMock(side_effect=_execute)
        session.add = MagicMock(side_effect=_add)
        session.refresh = AsyncMock(side_effect=_refresh)
        session.commit = AsyncMock(side_effect=_commit)
        return session


def _extract_session_id_from_calls(stmt) -> str:  # noqa: ANN001
    """Best-effort extraction of session_id from compiled statement."""
    return ""


def _extract_source_from_calls(stmt) -> str:  # noqa: ANN001
    return ""


def _extract_session_id_from_position_calls(stmt) -> str:  # noqa: ANN001
    return ""


class StatefulFakeSession:
    """A higher-fidelity fake that resolves queries against in-memory transcript state.

    Rather than parsing SQL, we intercept at the route level by rebuilding
    the mock DB per-request with the correct dedup/chain state pre-configured.
    """

    def __init__(self) -> None:
        self.transcripts: list[MagicMock] = []
        self._next_id = 1
        self._arq_jobs: list[dict] = []

    def _find_recent_dedup(self, session_id: str, source: str) -> MagicMock | None:
        for t in reversed(self.transcripts):
            if t.session_id == session_id and t.source == source and getattr(t, "_dedup_active", True):
                return t
        return None

    def _chain_count(self, session_id: str) -> int:
        return sum(1 for t in self.transcripts if t.session_id == session_id)

    def _max_processed_line(self, session_id: str) -> int | None:
        best = 0
        for t in self.transcripts:
            if t.session_id == session_id and getattr(t, "last_processed_line", 0) > 0:
                best = max(best, t.last_processed_line)
        return best if best > 0 else None

    def simulate_dream_completion(self, transcript_id: int, last_processed_line: int) -> None:
        for t in self.transcripts:
            if t.id == transcript_id:
                t.status = "processed"
                t.last_processed_line = last_processed_line
                return
        raise ValueError(f"Transcript {transcript_id} not found")

    def simulate_dream_failure(self, transcript_id: int) -> None:
        for t in self.transcripts:
            if t.id == transcript_id:
                t.status = "extraction_failed"
                t.last_processed_line = 0
                return
        raise ValueError(f"Transcript {transcript_id} not found")

    def disable_dedup_for(self, session_id: str, source: str) -> None:
        for t in self.transcripts:
            if t.session_id == session_id and t.source == source:
                t._dedup_active = False

    def _make_session_mock(
        self,
        session_id: str,
        source: str,
        *,
        force_no_dedup: bool = False,
    ) -> AsyncMock:
        mock = AsyncMock()
        call_idx = {"n": 0}
        state = self

        async def _execute(stmt, *args, **kwargs):  # noqa: ANN001, ANN002, ANN003
            call_idx["n"] += 1
            r = MagicMock()

            stmt_str = str(stmt)
            if "last_processed_line" in stmt_str and "ORDER BY" in stmt_str:
                val = state._max_processed_line(session_id)
                r.scalar_one_or_none.return_value = val
                return r

            n = call_idx["n"]
            if n % 2 == 1:
                existing = None if force_no_dedup else state._find_recent_dedup(session_id, source)
                r.scalar_one_or_none.return_value = existing
                return r
            else:
                r.scalar.return_value = state._chain_count(session_id)
                return r

        def _add(obj):  # noqa: ANN001
            obj.id = state._next_id
            obj._dedup_active = True
            state._next_id += 1
            state.transcripts.append(obj)

        async def _refresh(obj):  # noqa: ANN001
            pass

        async def _commit():
            pass

        mock.execute = AsyncMock(side_effect=_execute)
        mock.add = MagicMock(side_effect=_add)
        mock.refresh = AsyncMock(side_effect=_refresh)
        mock.commit = AsyncMock(side_effect=_commit)
        return mock


def _make_arq() -> AsyncMock:
    pool = AsyncMock()
    jobs: list[dict] = []

    async def _enqueue(task_name: str, **kwargs: object) -> AsyncMock:
        jobs.append({"task": task_name, **kwargs})
        result = AsyncMock()
        result.job_id = f"job-{len(jobs)}"
        return result

    pool.enqueue_job = AsyncMock(side_effect=_enqueue)
    pool._jobs = jobs
    return pool


async def _make_client_and_state(
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[AsyncClient, StatefulFakeSession, AsyncMock, "FastAPI"]:  # type: ignore[name-defined]  # noqa: F821
    monkeypatch.setattr("app.main._run_migrations", AsyncMock())
    monkeypatch.setattr("app.main._start_arq_pool", AsyncMock())

    app = create_app()
    state = StatefulFakeSession()
    arq = _make_arq()
    app.state.redis_pool = arq

    return (
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test"),
        state,
        arq,
        app,
    )


async def _post_conversation(
    client: AsyncClient,
    app: object,
    state: StatefulFakeSession,
    session_id: str,
    source: str = "stop",
    segment_start_line: int = 0,
    segment_end_line: int = 0,
    *,
    force_no_dedup: bool = False,
) -> dict:
    from app.api.deps import get_db_session

    mock_db = state._make_session_mock(session_id, source, force_no_dedup=force_no_dedup)

    async def override_db() -> AsyncGenerator[AsyncMock, None]:
        yield mock_db

    app.dependency_overrides[get_db_session] = override_db  # type: ignore[attr-defined]

    body = _body(session_id, source, segment_start_line, segment_end_line)
    resp = await client.post("/conversations", json=body, headers=AUTH_HEADER)
    return resp.json() | {"status_code": resp.status_code}


async def _get_position(
    client: AsyncClient,
    app: object,
    state: StatefulFakeSession,
    session_id: str,
) -> dict:
    from app.api.deps import get_db_session

    mock_db = state._make_session_mock(session_id, "")

    async def override_db() -> AsyncGenerator[AsyncMock, None]:
        yield mock_db

    app.dependency_overrides[get_db_session] = override_db  # type: ignore[attr-defined]

    resp = await client.get(
        "/conversations/position",
        params={"session_id": session_id},
        headers=AUTH_HEADER,
    )
    return resp.json() | {"status_code": resp.status_code}


class TestFullConversationChain:
    """Test 1: Full conversation chain with 3 segments."""

    @pytest.mark.asyncio
    async def test_three_segment_chain(self, monkeypatch: pytest.MonkeyPatch) -> None:
        client, state, arq, app = await _make_client_and_state(monkeypatch)

        async with client:
            # --- Segment 1: initial transcript ---
            result = await _post_conversation(
                client, app, state,
                session_id="session-A",
                source="stop",
                segment_end_line=450,
            )
            assert result["status_code"] == 202
            t1_id = result["data"]["transcriptId"]
            assert t1_id == 1

            t1 = state.transcripts[0]
            assert t1.is_continuation is False
            assert t1.segment_end_line == 450
            assert t1.status == "queued"
            assert len(arq._jobs) == 1
            assert arq._jobs[0]["transcript_id"] == t1_id

            # --- Simulate light dream completion for segment 1 ---
            state.simulate_dream_completion(t1_id, last_processed_line=450)

            # --- Verify position ---
            pos = await _get_position(client, app, state, "session-A")
            assert pos["status_code"] == 200
            assert pos["last_line"] == 450

            # --- Segment 2: continuation with overlap ---
            result = await _post_conversation(
                client, app, state,
                session_id="session-A",
                source="stop",
                segment_start_line=430,
                segment_end_line=900,
                force_no_dedup=True,
            )
            assert result["status_code"] == 202
            t2_id = result["data"]["transcriptId"]
            assert t2_id == 2

            t2 = state.transcripts[1]
            assert t2.is_continuation is True
            assert t2.segment_start_line == 430
            assert t2.segment_end_line == 900
            assert len(arq._jobs) == 2

            # --- Simulate light dream completion for segment 2 ---
            state.simulate_dream_completion(t2_id, last_processed_line=900)

            # --- Verify position advanced ---
            pos = await _get_position(client, app, state, "session-A")
            assert pos["last_line"] == 900

            # --- Segment 3: final continuation ---
            result = await _post_conversation(
                client, app, state,
                session_id="session-A",
                source="stop",
                segment_start_line=880,
                segment_end_line=1200,
                force_no_dedup=True,
            )
            assert result["status_code"] == 202
            t3_id = result["data"]["transcriptId"]
            assert t3_id == 3

            t3 = state.transcripts[2]
            assert t3.is_continuation is True
            assert t3.segment_start_line == 880
            assert t3.segment_end_line == 1200
            assert len(arq._jobs) == 3

            # All three transcripts belong to same session
            assert all(t.session_id == "session-A" for t in state.transcripts)


class TestPreCompactPlusStopChain:
    """Test 2: Pre-compact followed by stop from same session."""

    @pytest.mark.asyncio
    async def test_pre_compact_then_stop(self, monkeypatch: pytest.MonkeyPatch) -> None:
        client, state, arq, app = await _make_client_and_state(monkeypatch)

        async with client:
            # --- Pre-compact segment ---
            result = await _post_conversation(
                client, app, state,
                session_id="session-B",
                source="pre-compact",
                segment_end_line=300,
            )
            assert result["status_code"] == 202
            t1_id = result["data"]["transcriptId"]

            t1 = state.transcripts[0]
            assert t1.is_continuation is False
            assert t1.source == "pre-compact"
            assert len(arq._jobs) == 1

            # --- Simulate dream completion ---
            state.simulate_dream_completion(t1_id, last_processed_line=300)

            # --- Stop segment (different source, so no dedup) ---
            result = await _post_conversation(
                client, app, state,
                session_id="session-B",
                source="stop",
                segment_start_line=280,
                segment_end_line=500,
            )
            assert result["status_code"] == 202
            t2_id = result["data"]["transcriptId"]
            assert t2_id == 2

            t2 = state.transcripts[1]
            assert t2.is_continuation is True
            assert t2.source == "stop"
            assert t2.segment_start_line == 280
            assert t2.segment_end_line == 500
            assert len(arq._jobs) == 2


class TestFailedDreamDoesNotAdvancePosition:
    """Test 3: Failed light dream does not advance last_processed_line."""

    @pytest.mark.asyncio
    async def test_failed_dream_position_stays_zero(self, monkeypatch: pytest.MonkeyPatch) -> None:
        client, state, arq, app = await _make_client_and_state(monkeypatch)

        async with client:
            # --- Post initial transcript ---
            result = await _post_conversation(
                client, app, state,
                session_id="session-C",
                source="stop",
                segment_end_line=400,
            )
            assert result["status_code"] == 202
            t1_id = result["data"]["transcriptId"]

            # --- Simulate dream FAILURE ---
            state.simulate_dream_failure(t1_id)

            # --- Position should still be 0 ---
            pos = await _get_position(client, app, state, "session-C")
            assert pos["last_line"] == 0

    @pytest.mark.asyncio
    async def test_dedup_blocks_immediate_retry(self, monkeypatch: pytest.MonkeyPatch) -> None:
        client, state, arq, app = await _make_client_and_state(monkeypatch)

        async with client:
            # --- First post ---
            result1 = await _post_conversation(
                client, app, state,
                session_id="session-C2",
                source="stop",
                segment_end_line=400,
            )
            assert result1["status_code"] == 202

            # --- Simulate failure ---
            state.simulate_dream_failure(result1["data"]["transcriptId"])

            # --- Immediate retry within dedup window → duplicate ---
            result2 = await _post_conversation(
                client, app, state,
                session_id="session-C2",
                source="stop",
                segment_end_line=400,
            )
            assert result2["status_code"] == 200
            assert result2["data"]["duplicate"] is True
            assert result2["data"]["transcriptId"] == result1["data"]["transcriptId"]

    @pytest.mark.asyncio
    async def test_retry_after_dedup_window_creates_new_row(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, state, arq, app = await _make_client_and_state(monkeypatch)

        async with client:
            # --- First post ---
            result1 = await _post_conversation(
                client, app, state,
                session_id="session-C3",
                source="stop",
                segment_end_line=400,
            )
            assert result1["status_code"] == 202

            # --- Simulate failure + dedup window expiry ---
            state.simulate_dream_failure(result1["data"]["transcriptId"])
            state.disable_dedup_for("session-C3", "stop")

            # --- Retry after window → new transcript ---
            result2 = await _post_conversation(
                client, app, state,
                session_id="session-C3",
                source="stop",
                segment_end_line=400,
                force_no_dedup=True,
            )
            assert result2["status_code"] == 202
            assert result2["data"]["transcriptId"] != result1["data"]["transcriptId"]
            assert len(state.transcripts) == 2


class TestDedupWithin60sWindow:
    """Test 4: Duplicate detection within the 60-second window."""

    @pytest.mark.asyncio
    async def test_duplicate_returns_same_id(self, monkeypatch: pytest.MonkeyPatch) -> None:
        client, state, arq, app = await _make_client_and_state(monkeypatch)

        async with client:
            # --- First post ---
            result1 = await _post_conversation(
                client, app, state,
                session_id="session-D",
                source="stop",
            )
            assert result1["status_code"] == 202
            t1_id = result1["data"]["transcriptId"]
            assert len(arq._jobs) == 1

            # --- Immediate duplicate ---
            result2 = await _post_conversation(
                client, app, state,
                session_id="session-D",
                source="stop",
            )
            assert result2["status_code"] == 200
            assert result2["data"]["duplicate"] is True
            assert result2["data"]["transcriptId"] == t1_id

            # Only 1 arq job was queued (not 2)
            assert len(arq._jobs) == 1

    @pytest.mark.asyncio
    async def test_different_source_not_duplicate(self, monkeypatch: pytest.MonkeyPatch) -> None:
        client, state, arq, app = await _make_client_and_state(monkeypatch)

        async with client:
            result1 = await _post_conversation(
                client, app, state,
                session_id="session-D2",
                source="stop",
            )
            assert result1["status_code"] == 202

            result2 = await _post_conversation(
                client, app, state,
                session_id="session-D2",
                source="pre-compact",
            )
            assert result2["status_code"] == 202
            assert result2["data"]["transcriptId"] != result1["data"]["transcriptId"]
            assert len(arq._jobs) == 2
