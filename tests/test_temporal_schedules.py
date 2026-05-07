"""Tests for app/temporal_schedules.py — AC12 (a) (b) (c)."""

from __future__ import annotations

import datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from temporalio.service import RPCError, RPCStatusCode

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_mock_client(
    *,
    deep_exists: bool = False,
    weekly_exists: bool = False,
) -> MagicMock:
    """Return a MagicMock Temporal client.

    The describe() call raises NOT_FOUND when the schedule does not exist,
    otherwise returns normally (simulating an existing schedule).
    """
    client = MagicMock()
    client.create_schedule = AsyncMock()

    def _get_handle(schedule_id: str) -> MagicMock:
        handle = MagicMock()
        exists = (schedule_id == "deep-dream-nightly" and deep_exists) or (
            schedule_id == "weekly-review" and weekly_exists
        )

        if exists:
            handle.describe = AsyncMock(return_value=MagicMock())
            handle.update = AsyncMock()
        else:
            not_found = RPCError(
                "schedule not found",
                RPCStatusCode.NOT_FOUND,
                "",
            )
            handle.describe = AsyncMock(side_effect=not_found)
            handle.update = AsyncMock()

        return handle

    client.get_schedule_handle = MagicMock(side_effect=_get_handle)
    return client


# ---------------------------------------------------------------------------
# (a) Idempotency — create on first call, update on second
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_register_schedules_creates_both_on_first_call() -> None:
    """AC12(a): When neither schedule exists, create_schedule is called twice."""
    client = _make_mock_client(deep_exists=False, weekly_exists=False)

    with patch("app.temporal_schedules._read_cron", AsyncMock(return_value="0 20 * * *")), patch(
        "app.temporal_schedules._read_weekly_cron", AsyncMock(return_value="0 20 * * 0")
    ):
        from app.temporal_schedules import register_schedules

        await register_schedules(client)

    assert client.create_schedule.await_count == 2


@pytest.mark.asyncio
async def test_register_schedules_updates_both_on_second_call() -> None:
    """AC12(a): When both schedules already exist, update is called and create is not."""
    client = _make_mock_client(deep_exists=True, weekly_exists=True)

    with patch("app.temporal_schedules._read_cron", AsyncMock(return_value="0 20 * * *")), patch(
        "app.temporal_schedules._read_weekly_cron", AsyncMock(return_value="0 20 * * 0")
    ):
        from app.temporal_schedules import register_schedules

        await register_schedules(client)

    assert client.create_schedule.await_count == 0
    handles = [call.return_value for call in client.get_schedule_handle.call_args_list]
    for handle in handles:
        handle.update.assert_awaited_once()


@pytest.mark.asyncio
async def test_register_schedules_idempotent_combined() -> None:
    """AC12(a): First call creates; second call (existing) updates; no extra creates."""
    client_first = _make_mock_client(deep_exists=False, weekly_exists=False)
    client_second = _make_mock_client(deep_exists=True, weekly_exists=True)

    with patch("app.temporal_schedules._read_cron", AsyncMock(return_value="0 20 * * *")), patch(
        "app.temporal_schedules._read_weekly_cron", AsyncMock(return_value="0 20 * * 0")
    ):
        from app.temporal_schedules import register_schedules

        await register_schedules(client_first)
        assert client_first.create_schedule.await_count == 2

        await register_schedules(client_second)
        assert client_second.create_schedule.await_count == 0


# ---------------------------------------------------------------------------
# (b) Cron expression comes from config
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_register_schedules_uses_cron_from_config() -> None:
    """AC12(b): Custom cron from config.yml is passed to create_schedule spec."""
    custom_deep_cron = "30 19 * * *"
    custom_weekly_cron = "0 18 * * 0"

    client = _make_mock_client(deep_exists=False, weekly_exists=False)

    with patch(
        "app.temporal_schedules._read_cron", AsyncMock(return_value=custom_deep_cron)
    ), patch(
        "app.temporal_schedules._read_weekly_cron", AsyncMock(return_value=custom_weekly_cron)
    ):
        from app.temporal_schedules import register_schedules

        await register_schedules(client)

    assert client.create_schedule.await_count == 2
    calls: list[Any] = client.create_schedule.call_args_list

    # First call is deep-dream-nightly, second is weekly-review
    deep_call_schedule = calls[0].args[1]
    weekly_call_schedule = calls[1].args[1]

    assert deep_call_schedule.spec.cron_expressions == [custom_deep_cron]
    assert weekly_call_schedule.spec.cron_expressions == [custom_weekly_cron]


# ---------------------------------------------------------------------------
# (c) Signal payload shape — relay workflow unit test
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_relay_workflow_deep_computes_target_date() -> None:
    """AC12(c): ScheduleSignalRelayWorkflow for 'deep' signals submit_deep with target_date."""
    mock_handle = AsyncMock()
    fixed_date = datetime.datetime(2026, 5, 7, 20, 0, 0, tzinfo=datetime.UTC)

    with patch(
        "app.workflows.schedule_relay.workflow.now", return_value=fixed_date
    ), patch(
        "app.workflows.schedule_relay.workflow.get_external_workflow_handle",
        return_value=mock_handle,
    ):
        from app.workflows.schedule_relay import ScheduleSignalRelayWorkflow

        instance = ScheduleSignalRelayWorkflow()
        await instance.run("deep")

    mock_handle.signal.assert_awaited_once_with(
        "submit_deep",
        {"trigger": "auto", "target_date": "2026-05-07"},
    )


@pytest.mark.asyncio
async def test_relay_workflow_weekly_computes_week_start() -> None:
    """AC12(c): Relay for 'weekly' signals submit_weekly with week_start (Monday)."""
    mock_handle = AsyncMock()
    # 2026-05-07 is a Thursday; Monday of that week is 2026-05-04
    fixed_date = datetime.datetime(2026, 5, 7, 20, 0, 0, tzinfo=datetime.UTC)

    with patch(
        "app.workflows.schedule_relay.workflow.now", return_value=fixed_date
    ), patch(
        "app.workflows.schedule_relay.workflow.get_external_workflow_handle",
        return_value=mock_handle,
    ):
        from app.workflows.schedule_relay import ScheduleSignalRelayWorkflow

        instance = ScheduleSignalRelayWorkflow()
        await instance.run("weekly")

    mock_handle.signal.assert_awaited_once_with(
        "submit_weekly",
        {"trigger": "auto", "week_start": "2026-05-04"},
    )


@pytest.mark.asyncio
async def test_relay_workflow_weekly_on_monday_uses_same_day() -> None:
    """week_start on a Monday is the Monday itself."""
    mock_handle = AsyncMock()
    # 2026-05-04 is a Monday
    fixed_date = datetime.datetime(2026, 5, 4, 20, 0, 0, tzinfo=datetime.UTC)

    with patch(
        "app.workflows.schedule_relay.workflow.now", return_value=fixed_date
    ), patch(
        "app.workflows.schedule_relay.workflow.get_external_workflow_handle",
        return_value=mock_handle,
    ):
        from app.workflows.schedule_relay import ScheduleSignalRelayWorkflow

        instance = ScheduleSignalRelayWorkflow()
        await instance.run("weekly")

    mock_handle.signal.assert_awaited_once_with(
        "submit_weekly",
        {"trigger": "auto", "week_start": "2026-05-04"},
    )
