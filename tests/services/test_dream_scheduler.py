import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.dream_scheduler import DreamScheduler


@pytest.fixture
def mock_pool() -> AsyncMock:
    pool = AsyncMock()
    pool.enqueue_job = AsyncMock(return_value=MagicMock(job_id="test-job"))
    pool.abort_job = AsyncMock()
    return pool


@pytest.fixture
def scheduler(mock_pool: AsyncMock) -> DreamScheduler:
    return DreamScheduler(mock_pool)


async def test_notify_wakes_scheduler(scheduler: DreamScheduler) -> None:
    assert not scheduler._wake_event.is_set()
    scheduler.notify_config_changed()
    assert scheduler._wake_event.is_set()


async def test_scheduler_enqueues_job(
    scheduler: DreamScheduler, mock_pool: AsyncMock
) -> None:
    with patch.object(
        scheduler, "_read_cron", new_callable=AsyncMock, return_value="0 20 * * *"
    ):
        task = asyncio.create_task(scheduler.run())
        await asyncio.sleep(0.1)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    mock_pool.enqueue_job.assert_called_once()
    call_kwargs = mock_pool.enqueue_job.call_args
    assert call_kwargs[0][0] == "deep_dream_task"
    assert "trigger" in call_kwargs[1]
    assert "_defer_until" in call_kwargs[1]
    assert "_job_id" in call_kwargs[1]


async def test_scheduler_reschedules_on_notify(
    scheduler: DreamScheduler, mock_pool: AsyncMock
) -> None:
    call_count = 0

    async def mock_read_cron() -> str:
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return "0 20 * * *"
        return "0 8 * * *"

    with patch.object(scheduler, "_read_cron", side_effect=mock_read_cron):
        task = asyncio.create_task(scheduler.run())
        await asyncio.sleep(0.05)
        scheduler.notify_config_changed()
        await asyncio.sleep(0.1)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    assert mock_pool.enqueue_job.call_count >= 2


async def test_scheduler_aborts_old_job_on_cron_change(
    scheduler: DreamScheduler, mock_pool: AsyncMock
) -> None:
    call_count = 0

    async def mock_read_cron() -> str:
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return "0 20 * * *"
        return "0 6 * * *"

    with patch.object(scheduler, "_read_cron", side_effect=mock_read_cron):
        task = asyncio.create_task(scheduler.run())
        await asyncio.sleep(0.05)
        scheduler.notify_config_changed()
        await asyncio.sleep(0.1)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    mock_pool.abort_job.assert_called_once()


async def test_scheduler_handles_enqueue_failure(
    scheduler: DreamScheduler, mock_pool: AsyncMock
) -> None:
    mock_pool.enqueue_job = AsyncMock(side_effect=ConnectionError("Redis down"))

    with patch.object(
        scheduler, "_read_cron", new_callable=AsyncMock, return_value="0 20 * * *"
    ):
        task = asyncio.create_task(scheduler.run())
        await asyncio.sleep(0.1)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    # Should not crash — error is logged and loop continues
    mock_pool.enqueue_job.assert_called_once()


async def test_read_cron_falls_back_on_missing_config(
    scheduler: DreamScheduler,
) -> None:
    with patch("app.services.dream_scheduler.settings") as mock_settings:
        mock_settings.ai_memory_repo_path = "/nonexistent/path"
        result = await scheduler._read_cron()

    from app.models.config_schemas import DEFAULT_DEEP_DREAM_CRON

    assert result == DEFAULT_DEEP_DREAM_CRON
