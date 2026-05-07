from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from temporalio import activity
from temporalio.exceptions import ApplicationError

from app.activities.weekly._models import GatherDailysResult, WeeklyReviewPayload
from app.models.db import async_session_factory
from app.models.tables import Dream
from app.services.memory_files import read_vault_file


@activity.defn(name="weekly.gather_dailys")
async def gather_dailys(payload: WeeklyReviewPayload) -> GatherDailysResult:
    week_start_date = date.fromisoformat(payload.week_start)

    # Create Dream row (type=weekly_review)
    dream = Dream(
        type="weekly_review",
        trigger=payload.trigger,
        status="processing",
        transcript_id=None,
        started_at=datetime.now(UTC),
    )
    async with async_session_factory() as session:
        session.add(dream)
        await session.commit()
        await session.refresh(dream)
        dream_id: int = dream.id

    # Gather last 7 days of daily logs starting from week_start
    daily_logs: dict[str, str] = {}
    for i in range(7):
        d = week_start_date + timedelta(days=i)
        content = await read_vault_file(f"dailys/{d.isoformat()}.md")
        if content:
            daily_logs[d.isoformat()] = content

    if not daily_logs:
        raise ApplicationError(
            f"No daily logs found for week starting {payload.week_start}",
            non_retryable=True,
        )

    activity.logger.info(
        "weekly.gather_dailys.completed",
        dream_id=dream_id,
        daily_count=len(daily_logs),
    )
    return GatherDailysResult(
        dream_id=dream_id,
        week_start=payload.week_start,
        daily_logs=daily_logs,
    )
