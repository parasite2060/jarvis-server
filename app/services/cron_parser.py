from datetime import UTC, datetime

from croniter import croniter

from app.core.logging import get_logger
from app.models.config_schemas import DEFAULT_DEEP_DREAM_CRON

log = get_logger("jarvis.services.cron_parser")


def next_run_from_cron(expr: str, after: datetime | None = None) -> datetime:
    after = after or datetime.now(UTC)
    try:
        cron = croniter(expr, after)
    except (ValueError, KeyError):
        log.warning(
            "cron_parser.invalid_expression",
            expression=expr,
            fallback=DEFAULT_DEEP_DREAM_CRON,
        )
        cron = croniter(DEFAULT_DEEP_DREAM_CRON, after)
    next_dt: datetime = cron.get_next(datetime)
    if next_dt.tzinfo is None:
        next_dt = next_dt.replace(tzinfo=UTC)
    return next_dt
