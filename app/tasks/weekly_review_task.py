import time
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import select

from app.core.logging import get_logger
from app.models.db import async_session_factory
from app.models.tables import Dream
from app.services.context_cache import invalidate_context_cache
from app.services.dream_agent import WeeklyReviewDeps, run_weekly_review
from app.services.git_ops import git_ops_service
from app.services.memory_files import append_vault_log, read_vault_file, write_vault_file

log = get_logger("jarvis.tasks.weekly_review")

VAULT_INDEX_FOLDERS = (
    "decisions", "patterns", "concepts", "connections", "lessons", "projects",
)


def _week_number(d: date) -> str:
    iso_year, iso_week, _ = d.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


def _build_review_frontmatter(source_date: date, week_num: str) -> str:
    return (
        "---\n"
        "type: review\n"
        "tags: [review, weekly]\n"
        f"created: {source_date.isoformat()}\n"
        f"week: {week_num}\n"
        "---\n"
    )


async def weekly_review_task(ctx: dict[str, Any], trigger: str = "auto") -> None:
    log.info("weekly_review.started", trigger=trigger)
    start_ms = time.monotonic_ns() // 1_000_000

    source_date = date.today()
    week_num = _week_number(source_date)

    # Step 1: Create dream row
    dream = Dream(
        type="weekly_review",
        trigger=trigger,
        status="processing",
        transcript_id=None,
        started_at=datetime.now(UTC),
    )
    async with async_session_factory() as session:
        session.add(dream)
        await session.commit()
        await session.refresh(dream)
        dream_id: int = dream.id

    # Step 2: Gather 7 days of daily logs
    daily_logs: dict[str, str] = {}
    for i in range(7):
        d = source_date - timedelta(days=i)
        content = await read_vault_file(f"dailys/{d.isoformat()}.md")
        if content:
            daily_logs[d.isoformat()] = content

    if not daily_logs:
        log.info("weekly_review.skipped", dream_id=dream_id, reason="no_daily_logs")
        await _mark_skipped(dream_id, start_ms)
        return

    # Step 3: Gather vault indexes
    vault_indexes: dict[str, str] = {}
    for folder in VAULT_INDEX_FOLDERS:
        content = await read_vault_file(f"{folder}/_index.md")
        if content:
            vault_indexes[folder] = content

    # Step 3b: Read vault guide for review format reference
    vault_guide = await read_vault_file("_guide.md") or ""

    # Step 4: Run weekly review agent
    usage_input_tokens: int | None = None
    usage_output_tokens: int | None = None
    usage_total_tokens: int | None = None
    usage_tool_calls: int | None = None
    try:
        deps = WeeklyReviewDeps(
            source_date=source_date,
            week_number=week_num,
            daily_logs=daily_logs,
            vault_indexes=vault_indexes,
            vault_guide=vault_guide,
        )
        output, usage, tool_call_count = await run_weekly_review(deps)
        usage_input_tokens = usage.request_tokens
        usage_output_tokens = usage.response_tokens
        usage_total_tokens = usage.total_tokens
        usage_tool_calls = tool_call_count
        log.info(
            "weekly_review.agent.completed",
            dream_id=dream_id,
            total_tokens=usage_total_tokens,
            tool_calls=usage_tool_calls,
            themes=len(output.week_themes),
        )
    except Exception as exc:
        log.error("weekly_review.agent.failed", dream_id=dream_id, error=str(exc))
        await _mark_failed(dream_id, str(exc), start_ms)
        return

    if not output.review_content:
        log.info("weekly_review.skipped", dream_id=dream_id, reason="empty_review")
        await _mark_skipped(dream_id, start_ms)
        return

    # Step 5: Write review file
    review_path = f"reviews/{week_num}.md"
    frontmatter = _build_review_frontmatter(source_date, week_num)
    review_full = frontmatter + output.review_content
    files_modified: list[dict[str, object]] = []
    try:
        await write_vault_file(review_path, review_full)
        files_modified.append({"path": review_path, "action": "create"})
        try:
            await append_vault_log("review", f"Weekly review {week_num} generated")
        except Exception as log_exc:
            log.warning("weekly_review.vault_log.failed", dream_id=dream_id, error=str(log_exc))
        log.info("weekly_review.file_written", path=review_path)
    except Exception as exc:
        log.error("weekly_review.file_write.failed", dream_id=dream_id, error=str(exc))
        await _mark_failed(dream_id, str(exc), start_ms)
        return

    # Step 6: Git branch and PR
    git_result: dict[str, str] = {"git_branch": "", "git_pr_url": "", "git_pr_status": ""}
    branch_name: str = ""
    try:
        git_result = await git_ops_service.create_weekly_review_pr(
            files_modified,
            dream_id,
            week_num,
            source_date,
        )
        branch_name = git_result.get("git_branch", "")
    except Exception as exc:
        log.error("weekly_review.git.failed", dream_id=dream_id, error=str(exc))
    finally:
        if branch_name:
            await git_ops_service.cleanup_branch(branch_name)

    # Cache invalidation is decoupled from git outcome: the review file has
    # already been written to the vault, so cached context is stale regardless
    # of whether the PR step succeeded.
    try:
        await invalidate_context_cache()
    except Exception as exc:
        log.warning("weekly_review.cache_invalidate.failed", error=str(exc))

    # Step 7: Update dream row
    duration_ms = time.monotonic_ns() // 1_000_000 - start_ms
    input_summary = (
        f"daily_logs={len(daily_logs)}, "
        f"vault_indexes={len(vault_indexes)}, "
        f"week={week_num}"
    )
    output_summary = (
        f"themes={len(output.week_themes)}, "
        f"stale_items={len(output.stale_action_items)}, "
        f"project_updates={len(output.project_updates)}"
    )

    async with async_session_factory() as session:
        result = await session.execute(select(Dream).where(Dream.id == dream_id))
        d: Dream = result.scalar_one()
        d.status = "completed"
        d.input_tokens = usage_input_tokens
        d.output_tokens = usage_output_tokens
        d.total_tokens = usage_total_tokens
        d.tool_calls = usage_tool_calls
        d.duration_ms = duration_ms
        d.completed_at = datetime.now(UTC)
        d.files_modified = files_modified  # type: ignore[assignment]
        d.git_branch = git_result.get("git_branch", "")
        d.git_pr_url = git_result.get("git_pr_url", "")
        d.git_pr_status = git_result.get("git_pr_status", "")
        d.input_summary = input_summary
        d.output_raw = output_summary
        await session.commit()

    log.info(
        "weekly_review.completed",
        dream_id=dream_id,
        trigger=trigger,
        duration_ms=duration_ms,
        week=week_num,
        themes=len(output.week_themes),
        git_pr_url=git_result.get("git_pr_url", ""),
    )


async def _mark_failed(dream_id: int, error_message: str, start_ms: int) -> None:
    duration_ms = time.monotonic_ns() // 1_000_000 - start_ms
    async with async_session_factory() as session:
        result = await session.execute(select(Dream).where(Dream.id == dream_id))
        d: Dream = result.scalar_one()
        d.status = "failed"
        d.error_message = error_message
        d.duration_ms = duration_ms
        d.completed_at = datetime.now(UTC)
        await session.commit()
    log.error("weekly_review.failed", dream_id=dream_id, duration_ms=duration_ms)


async def _mark_skipped(dream_id: int, start_ms: int) -> None:
    duration_ms = time.monotonic_ns() // 1_000_000 - start_ms
    async with async_session_factory() as session:
        result = await session.execute(select(Dream).where(Dream.id == dream_id))
        d: Dream = result.scalar_one()
        d.status = "skipped"
        d.duration_ms = duration_ms
        d.completed_at = datetime.now(UTC)
        await session.commit()
    log.info("weekly_review.skipped", dream_id=dream_id, duration_ms=duration_ms)
