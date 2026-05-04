from collections.abc import AsyncGenerator
from typing import Any
from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.deps import get_db_session
from app.models.tables import DreamPhase

API_KEY = "test-api-key"
AUTH_HEADER = {"Authorization": f"Bearer {API_KEY}"}


class _FakeResult:
    def __init__(self, row: Any) -> None:
        self._row = row

    def scalar_one_or_none(self) -> Any:
        return self._row


class _FakeDbSession:
    def __init__(self, row: Any) -> None:
        self._row = row

    async def execute(self, _stmt: Any) -> _FakeResult:
        return _FakeResult(self._row)


@pytest.fixture
async def trace_app(
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncGenerator[tuple[AsyncClient, dict[str, Any]], None]:
    monkeypatch.setattr("app.main._run_migrations", AsyncMock())
    monkeypatch.setattr("app.main._start_arq_pool", AsyncMock())
    monkeypatch.setattr("app.main._start_dream_scheduler", AsyncMock())
    monkeypatch.setattr("app.main._vault_sync_loop", AsyncMock())

    from app.main import create_app

    app = create_app()
    state: dict[str, Any] = {"row": None}

    async def _override_session() -> AsyncGenerator[_FakeDbSession, None]:
        yield _FakeDbSession(state["row"])

    app.dependency_overrides[get_db_session] = _override_session

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac, state


def _make_phase(history: list[dict] | None) -> DreamPhase:
    return DreamPhase(
        dream_id=1,
        phase="extraction",
        status="completed",
        conversation_history=history,
    )


@pytest.mark.asyncio
async def test_trace_returns_404_when_phase_missing(
    trace_app: tuple[AsyncClient, dict[str, Any]],
) -> None:
    client, state = trace_app
    state["row"] = None

    response = await client.get("/dreams/999/phases/extraction/trace", headers=AUTH_HEADER)

    assert response.status_code == 404
    body = response.json()
    assert body["detail"]["error"]["code"] == "NOT_FOUND"
    assert body["detail"]["status"] == "error"


@pytest.mark.asyncio
async def test_trace_returns_rendered_content_for_present_phase(
    trace_app: tuple[AsyncClient, dict[str, Any]],
) -> None:
    client, state = trace_app
    state["row"] = _make_phase(
        [
            {
                "kind": "request",
                "parts": [
                    {"part_kind": "system-prompt", "content": "You are extraction."},
                    {"part_kind": "user-prompt", "content": "Extract"},
                ],
            },
            {
                "kind": "response",
                "parts": [
                    {
                        "part_kind": "tool-call",
                        "tool_name": "search",
                        "args": {"q": "x"},
                        "tool_call_id": "c1",
                    },
                ],
            },
        ]
    )

    response = await client.get("/dreams/1/phases/extraction/trace", headers=AUTH_HEADER)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    trace = body["data"]["trace"]
    assert "system [hash:" in trace
    assert "turn 1  assistant  → search(" in trace
    assert "user prompt:" in trace


@pytest.mark.asyncio
async def test_trace_returns_marker_when_history_null(
    trace_app: tuple[AsyncClient, dict[str, Any]],
) -> None:
    client, state = trace_app
    state["row"] = _make_phase(None)

    response = await client.get("/dreams/1/phases/extraction/trace", headers=AUTH_HEADER)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["data"]["trace"] == "_(no conversation recorded)_"


@pytest.mark.asyncio
async def test_trace_returns_401_without_auth(
    trace_app: tuple[AsyncClient, dict[str, Any]],
) -> None:
    client, _ = trace_app

    response = await client.get("/dreams/1/phases/extraction/trace")

    assert response.status_code == 401
