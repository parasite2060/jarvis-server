import asyncio
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient


@asynccontextmanager
async def _run_lifespan(app: Any) -> AsyncGenerator[None, None]:
    """Drive FastAPI lifespan without external dependencies."""
    startup_done = asyncio.Event()
    shutdown_done = asyncio.Event()
    receive_queue: asyncio.Queue[dict[str, str]] = asyncio.Queue()

    async def _send(event: dict[str, str]) -> None:
        if event["type"] == "lifespan.startup.complete":
            startup_done.set()
        elif event["type"] == "lifespan.shutdown.complete":
            shutdown_done.set()

    scope = {"type": "lifespan", "asgi": {"version": "3.0"}}
    lifespan_task = asyncio.create_task(app(scope, receive_queue.get, _send))

    await receive_queue.put({"type": "lifespan.startup"})
    await asyncio.wait_for(startup_done.wait(), timeout=5)

    try:
        yield
    finally:
        await receive_queue.put({"type": "lifespan.shutdown"})
        await asyncio.wait_for(shutdown_done.wait(), timeout=5)
        await lifespan_task


async def test_lifespan_temporal_worker_task_cancelled_on_shutdown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mock_client = MagicMock()
    mock_worker = MagicMock()

    async def fake_worker_run() -> None:
        await asyncio.sleep(9999)

    mock_worker.run = fake_worker_run

    monkeypatch.setattr("app.main._run_migrations", AsyncMock())
    monkeypatch.setattr("app.main._start_arq_pool", AsyncMock())
    monkeypatch.setattr("app.main._start_dream_scheduler", AsyncMock())
    monkeypatch.setattr("app.temporal_client.Client.connect", AsyncMock(return_value=mock_client))
    monkeypatch.setattr("app.temporal_worker.Worker", lambda *a, **kw: mock_worker)
    # Inject a non-empty workflow list so the worker is actually created
    monkeypatch.setattr(
        "app.main.build_temporal_worker",
        lambda client, **kw: mock_worker,
    )

    from app.main import create_app

    application = create_app()

    async with _run_lifespan(application):
        assert hasattr(application.state, "temporal_worker_task")
        assert not application.state.temporal_worker_task.done()

    assert application.state.temporal_worker_task.cancelled()


async def test_lifespan_shutdown_raises_no_exceptions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mock_client = MagicMock()
    mock_worker = MagicMock()

    async def fake_worker_run() -> None:
        await asyncio.sleep(9999)

    mock_worker.run = fake_worker_run

    monkeypatch.setattr("app.main._run_migrations", AsyncMock())
    monkeypatch.setattr("app.main._start_arq_pool", AsyncMock())
    monkeypatch.setattr("app.main._start_dream_scheduler", AsyncMock())
    monkeypatch.setattr("app.temporal_client.Client.connect", AsyncMock(return_value=mock_client))
    monkeypatch.setattr(
        "app.main.build_temporal_worker",
        lambda client, **kw: mock_worker,
    )

    from app.main import create_app

    application = create_app()

    async with _run_lifespan(application):
        async with AsyncClient(
            transport=ASGITransport(app=application),
            base_url="http://test",
        ) as ac:
            response = await ac.get("/health")
            assert response.status_code == 200


async def test_lifespan_empty_registries_no_worker_task(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With empty registries, temporal_worker_task is NOT created (SDK constraint)."""
    mock_client = MagicMock()

    monkeypatch.setattr("app.main._run_migrations", AsyncMock())
    monkeypatch.setattr("app.main._start_arq_pool", AsyncMock())
    monkeypatch.setattr("app.main._start_dream_scheduler", AsyncMock())
    monkeypatch.setattr("app.temporal_client.Client.connect", AsyncMock(return_value=mock_client))

    from app.main import create_app

    application = create_app()

    async with _run_lifespan(application):
        assert hasattr(application.state, "temporal_client")
        assert not hasattr(application.state, "temporal_worker_task")
