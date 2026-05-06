import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from temporalio.common import WorkflowIDReusePolicy


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


async def test_ensure_coordinator_running_calls_start_workflow_once() -> None:
    """AC14a: ensure_coordinator_running calls client.start_workflow exactly once."""
    from app.temporal_client import ensure_coordinator_running

    mock_client = AsyncMock()
    mock_client.start_workflow = AsyncMock()

    await ensure_coordinator_running(mock_client)

    mock_client.start_workflow.assert_awaited_once()
    _, kwargs = mock_client.start_workflow.call_args
    assert kwargs["id"] == "coord-singleton"
    assert kwargs["task_queue"] == "jarvis-dream"
    assert kwargs["id_reuse_policy"] == WorkflowIDReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY


async def test_ensure_coordinator_running_is_idempotent() -> None:
    """AC14a: Second call with same ID is a no-op (mock returns existing handle)."""
    from app.temporal_client import ensure_coordinator_running

    mock_client = AsyncMock()
    existing_handle = MagicMock()
    mock_client.start_workflow = AsyncMock(return_value=existing_handle)

    await ensure_coordinator_running(mock_client)
    await ensure_coordinator_running(mock_client)

    assert mock_client.start_workflow.await_count == 2


async def test_signal_coordinator_sends_correct_signal() -> None:
    """AC14b: signal_coordinator resolves to submit_light signal on coord-singleton."""
    mock_handle = AsyncMock()
    mock_handle.signal = AsyncMock()

    mock_client = MagicMock()
    mock_client.get_workflow_handle = MagicMock(return_value=mock_handle)

    with patch("app.temporal_client.get_temporal_client", AsyncMock(return_value=mock_client)):
        from app.temporal_client import signal_coordinator

        await signal_coordinator("light", {"session_id": "abc"})

    mock_client.get_workflow_handle.assert_called_once_with("coord-singleton")
    mock_handle.signal.assert_awaited_once_with("submit_light", {"session_id": "abc"})


async def test_signal_coordinator_deep_sends_submit_deep() -> None:
    """signal_coordinator("deep", ...) sends submit_deep signal."""
    mock_handle = AsyncMock()
    mock_handle.signal = AsyncMock()

    mock_client = MagicMock()
    mock_client.get_workflow_handle = MagicMock(return_value=mock_handle)

    with patch("app.temporal_client.get_temporal_client", AsyncMock(return_value=mock_client)):
        from app.temporal_client import signal_coordinator

        await signal_coordinator("deep", {"target_date": "2026-05-06"})

    mock_handle.signal.assert_awaited_once_with("submit_deep", {"target_date": "2026-05-06"})
