from __future__ import annotations

import time
from datetime import UTC, datetime

from temporalio import activity

from app.activities.weekly._models import AgentInput, AgentResult
from app.services.dream_agent import WeeklyReviewDeps, run_weekly_review
from app.services.dream_telemetry import store_phase_telemetry


def _week_number(week_start_iso: str) -> str:
    from datetime import date

    d = date.fromisoformat(week_start_iso)
    iso_year, iso_week, _ = d.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


@activity.defn(name="weekly.run_weekly_review_agent")
async def run_weekly_review_agent(inp: AgentInput) -> AgentResult:
    week_num = _week_number(inp.week_start)
    run_prompt = (
        f"Weekly review for {week_num}. "
        f"Daily logs: {len(inp.daily_logs)}, vault indexes: {len(inp.vault_indexes)}."
    )

    from datetime import date

    week_start_date = date.fromisoformat(inp.week_start)

    deps = WeeklyReviewDeps(
        source_date=week_start_date,
        week_number=week_num,
        daily_logs=inp.daily_logs,
        vault_indexes=inp.vault_indexes,
        vault_guide=inp.vault_guide,
    )

    started_at = datetime.now(UTC)
    start_ms = time.monotonic_ns() // 1_000_000

    output, usage, tool_call_count, messages = await run_weekly_review(deps)

    duration_ms = time.monotonic_ns() // 1_000_000 - start_ms

    # Story 11.2 invariant: dream_phases row written inside this activity
    await store_phase_telemetry(
        dream_id=inp.dream_id,
        phase="weekly_review",
        status="completed",
        run_prompt=run_prompt,
        output_json=output.model_dump(),
        messages=messages,
        usage=usage,
        tool_calls=tool_call_count,
        duration_ms=duration_ms,
        started_at=started_at,
    )

    activity.logger.info(
        "weekly.run_weekly_review_agent.completed",
        dream_id=inp.dream_id,
        total_tokens=usage.total_tokens,
        themes=len(output.week_themes),
    )
    return AgentResult(
        review_content=output.review_content,
        week_themes=output.week_themes,
        stale_action_items=output.stale_action_items,
        project_updates=output.project_updates,
        input_tokens=usage.request_tokens,
        output_tokens=usage.response_tokens,
        total_tokens=usage.total_tokens,
        tool_calls=tool_call_count,
    )
