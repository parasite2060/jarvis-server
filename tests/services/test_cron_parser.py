from datetime import UTC, datetime

from app.services.cron_parser import next_run_from_cron


def test_daily_8pm_utc() -> None:
    after = datetime(2026, 4, 5, 10, 0, 0, tzinfo=UTC)
    result = next_run_from_cron("0 20 * * *", after)
    assert result.hour == 20
    assert result.minute == 0
    assert result.day == 5


def test_every_2_minutes() -> None:
    after = datetime(2026, 4, 5, 10, 3, 0, tzinfo=UTC)
    result = next_run_from_cron("*/2 * * * *", after)
    assert result.minute == 4
    assert result.hour == 10


def test_invalid_expression_falls_back_to_default() -> None:
    after = datetime(2026, 4, 5, 10, 0, 0, tzinfo=UTC)
    result = next_run_from_cron("garbage", after)
    assert result.hour == 20
    assert result.minute == 0


def test_result_has_utc_timezone() -> None:
    after = datetime(2026, 4, 5, 10, 0, 0, tzinfo=UTC)
    result = next_run_from_cron("0 20 * * *", after)
    assert result.tzinfo is not None


def test_next_day_when_past_schedule() -> None:
    after = datetime(2026, 4, 5, 21, 0, 0, tzinfo=UTC)
    result = next_run_from_cron("0 20 * * *", after)
    assert result.day == 6
    assert result.hour == 20
