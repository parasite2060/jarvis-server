import shutil
import tempfile
import time
import uuid
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

from pydantic_ai.exceptions import UsageLimitExceeded
from sqlalchemy import select

from app.core.exceptions import DreamError
from app.core.logging import get_logger
from app.models.db import async_session_factory
from app.models.tables import Dream, Transcript
from app.services.context_cache import invalidate_context_cache
from app.services.dream_agent import DreamDeps, RecordDeps, run_dream_extraction, run_record
from app.services.dream_models import ExtractionSummary, SessionLogEntry
from app.services.dream_telemetry import store_phase_telemetry
from app.services.git_ops import git_ops_service
from app.services.memory_files import append_vault_log

log = get_logger("jarvis.tasks.light_dream")


def _determine_light_dream_outcome(
    *,
    extraction_failed: bool,
    summary: ExtractionSummary,
    record_raised: bool,
    files_modified: list[dict[str, object]],
) -> str | None:
    if extraction_failed:
        return None
    if getattr(summary, "no_extract", False):
        return "extraction_empty"
    if record_raised:
        return "record_soft_fail"
    if files_modified:
        return "wrote_files"
    return "no_new_content"


def _check_extraction_yield(
    *,
    total_tokens: int,
    tool_calls: int,
    extracted_items_count: int,
) -> bool:
    from app.config import settings as app_settings

    return (
        total_tokens > app_settings.extraction_yield_token_floor
        and tool_calls < app_settings.extraction_yield_tool_call_floor
        and extracted_items_count < app_settings.extraction_yield_extraction_floor
    )


def _apply_yield_check(
    *,
    outcome: str | None,
    dream_id: int,
    total_tokens: int | None,
    tool_calls: int | None,
    session_log: SessionLogEntry,
) -> str | None:
    if outcome not in ("wrote_files", "no_new_content"):
        return outcome
    try:
        tokens = total_tokens or 0
        calls = tool_calls or 0
        items = (
            len(session_log.memories)
            + len(session_log.lessons_learned)
            + len(session_log.decisions_made)
        )
        if _check_extraction_yield(
            total_tokens=tokens,
            tool_calls=calls,
            extracted_items_count=items,
        ):
            log.warning(
                "light_dream.extraction.under_yield",
                dream_id=dream_id,
                total_tokens=tokens,
                tool_calls=calls,
                extracted_items=items,
                original_outcome=outcome,
            )
            return "extraction_under_yield"
        return outcome
    except Exception as exc:
        log.warning(
            "light_dream.extraction.yield_check_failed",
            dream_id=dream_id,
            error_type=type(exc).__name__,
            error=str(exc),
        )
        return outcome


async def light_dream_task(ctx: dict[str, Any], transcript_id: int) -> None:
    log.info("light_dream.started", transcript_id=transcript_id)
    start_ms = time.monotonic_ns() // 1_000_000

    # Step 1: Load transcript
    async with async_session_factory() as session:
        result = await session.execute(select(Transcript).where(Transcript.id == transcript_id))
        transcript = result.scalar_one_or_none()

    if transcript is None:
        log.error("light_dream.transcript_not_found", transcript_id=transcript_id)
        return

    if transcript.status not in ("queued", "received"):
        log.warning(
            "light_dream.unexpected_status",
            transcript_id=transcript_id,
            status=transcript.status,
        )

    log.info("light_dream.transcript_loaded", transcript_id=transcript_id)

    # Step 2: Create dream row
    dream = Dream(
        type="light",
        trigger="auto",
        status="processing",
        transcript_id=transcript_id,
        started_at=datetime.now(UTC),
    )
    async with async_session_factory() as session:
        session.add(dream)
        await session.commit()
        await session.refresh(dream)
        dream_id: int = dream.id

    # Step 3: Update transcript with dream reference
    async with async_session_factory() as session:
        result = await session.execute(select(Transcript).where(Transcript.id == transcript_id))
        t = result.scalar_one()
        t.light_dream_id = dream_id
        t.status = "processing"
        await session.commit()

    # Step 4: Write transcript to temp workspace + vault transcripts/
    parsed_text = transcript.parsed_text or ""
    workspace = Path(tempfile.mkdtemp(prefix=f"dream-{dream_id}-", dir="/tmp/jarvis-dreams"))

    # Write transcript to vault transcripts/ for base tool access
    from app.config import settings as app_settings

    vault_root = Path(app_settings.jarvis_memory_path)
    transcripts_dir = vault_root / "transcripts"
    transcripts_dir.mkdir(parents=True, exist_ok=True)

    session_id_str = str(transcript.session_id) if hasattr(transcript, "session_id") else ""
    transcript_filename = f"{session_id_str}_{uuid.uuid4().hex[:8]}.txt"
    transcript_path = transcripts_dir / transcript_filename

    extraction_failed = False
    is_partial = False
    record_raised = False
    error_message: str | None = None
    memories_count = 0
    source_date_for_git = date.today()
    files_modified: list[dict[str, object]] = []
    usage_input_tokens: int | None = None
    usage_output_tokens: int | None = None
    usage_total_tokens: int | None = None
    usage_tool_calls: int | None = None
    # Default extraction output — overwritten on success; left untouched (no_extract=True
    # effective) when extraction raises or UsageLimitExceeded without a partial result.
    summary: ExtractionSummary = ExtractionSummary(no_extract=True)

    try:
        (workspace / "transcript.txt").write_text(parsed_text, encoding="utf-8")
        transcript_path.write_text(parsed_text, encoding="utf-8")

        # Step 5: Run extraction agent
        deps = DreamDeps(
            transcript_id=transcript_id,
            workspace=workspace,
            memories=[],
            session_id=session_id_str,
            project=getattr(transcript, "project", None),
            token_count=getattr(transcript, "token_count", None),
            created_at=getattr(transcript, "created_at", None),
            transcript_file=f"transcripts/{transcript_filename}",
        )

        extraction_run_prompt = (
            f"Extract session insights from transcript.\n"
            f"Session ID: {deps.session_id}, Project: {deps.project or 'unknown'}, "
            f"Token count: {deps.token_count or 'unknown'}"
        )
        extraction_start = time.monotonic_ns() // 1_000_000
        extraction_started_at = datetime.now(UTC)
        try:
            summary, usage, tool_calls, extraction_messages = await run_dream_extraction(deps)
            extraction_duration_ms = time.monotonic_ns() // 1_000_000 - extraction_start
            usage_input_tokens = getattr(usage, "request_tokens", None)
            usage_output_tokens = getattr(usage, "response_tokens", None)
            usage_total_tokens = getattr(usage, "total_tokens", None)
            usage_tool_calls = tool_calls
            log.info(
                "light_dream.extraction.completed",
                transcript_id=transcript_id,
                dream_id=dream_id,
                memories_count=len(deps.memories),
            )
            log.info(
                "light_dream.usage",
                dream_id=dream_id,
                input_tokens=usage_input_tokens,
                output_tokens=usage_output_tokens,
                total_tokens=usage_total_tokens,
                tool_calls=usage_tool_calls,
            )
            await store_phase_telemetry(
                dream_id=dream_id,
                phase="extraction",
                status="completed",
                run_prompt=extraction_run_prompt,
                output_json=summary.model_dump() if summary else None,
                messages=extraction_messages,
                usage=usage,
                tool_calls=tool_calls,
                duration_ms=extraction_duration_ms,
                started_at=extraction_started_at,
            )
        except UsageLimitExceeded as exc:
            extraction_duration_ms = time.monotonic_ns() // 1_000_000 - extraction_start
            is_partial = True
            error_message = str(exc)
            log.warning(
                "light_dream.extraction.partial",
                transcript_id=transcript_id,
                dream_id=dream_id,
                error=error_message,
            )
            await store_phase_telemetry(
                dream_id=dream_id,
                phase="extraction",
                status="failed",
                run_prompt=extraction_run_prompt,
                duration_ms=extraction_duration_ms,
                error_message=error_message,
            )
        except (DreamError, Exception) as exc:
            extraction_duration_ms = time.monotonic_ns() // 1_000_000 - extraction_start
            extraction_failed = True
            error_message = str(exc)
            log.error(
                "light_dream.extraction.failed",
                transcript_id=transcript_id,
                dream_id=dream_id,
                error=error_message,
            )
            await store_phase_telemetry(
                dream_id=dream_id,
                phase="extraction",
                status="failed",
                run_prompt=extraction_run_prompt,
                duration_ms=extraction_duration_ms,
                error_message=error_message,
            )

        # Step 6: Persist session log to dreams.session_log JSONB (single write).
        # This is the sole DB storage site for light-dream output. Memories live
        # inside session_log as session_log.memories (a list of MemoryItem objects) —
        # there is no separate per-memory table.
        session_log: SessionLogEntry = getattr(summary, "session_log", SessionLogEntry())
        memories_count = len(session_log.memories)
        # Derive source_date for git PR from the most recent MemoryItem; fall back to today.
        for item in session_log.memories:
            try:
                source_date_for_git = date.fromisoformat(item.source_date)
            except (ValueError, TypeError):
                continue

        if not extraction_failed and not getattr(summary, "no_extract", False):
            async with async_session_factory() as session:
                result_d = await session.execute(select(Dream).where(Dream.id == dream_id))
                d_row = result_d.scalar_one()
                d_row.session_log = session_log.model_dump()
                await session.commit()
            log.info(
                "light_dream.session_log_persisted",
                transcript_id=transcript_id,
                dream_id=dream_id,
                memories_count=memories_count,
            )

        # Step 7: Run record agent (writes daily log, tracks reinforcement).
        # Record reads memories via deps.session_log.memories — no peer field.
        no_extract = extraction_failed or (hasattr(summary, "no_extract") and summary.no_extract)
        if not no_extract and memories_count > 0:
            try:
                from app.config import settings as app_settings

                record_deps = RecordDeps(
                    workspace=Path(app_settings.jarvis_memory_path),
                    source_date=source_date_for_git,
                    session_id=deps.session_id,
                    summary=summary.summary if hasattr(summary, "summary") else "",
                    session_log=session_log,
                    is_continuation=getattr(transcript, "is_continuation", False),
                )
                record_run_prompt = (
                    f"Record session to daily log. Session: {deps.session_id}, "
                    f"Date: {source_date_for_git.isoformat()}, "
                    f"Memories: {memories_count}"
                )
                record_start = time.monotonic_ns() // 1_000_000
                record_started_at = datetime.now(UTC)
                record_result, record_usage, record_tool_calls, record_messages = await run_record(
                    record_deps, allowed_write_patterns=["dailys/*.md"]
                )
                record_duration_ms = time.monotonic_ns() // 1_000_000 - record_start
                files_modified = [{"path": f.path, "action": f.action} for f in record_result.files]
                log.info(
                    "light_dream.record.completed",
                    transcript_id=transcript_id,
                    dream_id=dream_id,
                    files_count=len(files_modified),
                    record_summary=record_result.summary,
                )
                await store_phase_telemetry(
                    dream_id=dream_id,
                    phase="record",
                    status="completed",
                    run_prompt=record_run_prompt,
                    output_json={
                        "files": [f.model_dump() for f in record_result.files],
                        "summary": record_result.summary,
                    },
                    messages=record_messages,
                    usage=record_usage,
                    tool_calls=record_tool_calls,
                    duration_ms=record_duration_ms,
                    started_at=record_started_at,
                )
                try:
                    summary_title = record_deps.summary[:60] if record_deps.summary else "session"
                    await append_vault_log(
                        "ingest",
                        f'Session "{summary_title}" -> dailys/{source_date_for_git.isoformat()}.md',
                    )
                    summary_lower = (record_result.summary or "").lower()
                    for f in record_result.files:
                        if f.action == "update" and "reinforc" in summary_lower:
                            await append_vault_log("reinforce", f.path)
                except Exception as log_exc:
                    log.warning("light_dream.vault_log.failed", error=str(log_exc))
            except Exception as exc:
                record_raised = True
                log.warning(
                    "light_dream.record.failed",
                    transcript_id=transcript_id,
                    dream_id=dream_id,
                    error=str(exc),
                )

        # Step 8: Git branch and PR
        git_branch: str | None = None
        git_pr_url: str | None = None
        git_pr_status: str | None = None

        if files_modified:
            source_time = dream.started_at.strftime("%H%M%S") if dream.started_at else "000000"
            try:
                git_result = await git_ops_service.create_light_dream_pr(
                    files_modified, dream_id, source_date_for_git, source_time
                )
                git_branch = git_result.get("git_branch")
                git_pr_url = git_result.get("git_pr_url")
                git_pr_status = git_result.get("git_pr_status")
                log.info(
                    "light_dream.git_pr.created",
                    dream_id=dream_id,
                    git_branch=git_branch,
                    git_pr_url=git_pr_url,
                )
            except Exception as exc:
                log.warning("light_dream.git_ops_failed", dream_id=dream_id, error=str(exc))
            finally:
                fallback = f"dream/light-{date.today().isoformat()}-{source_time}"
                branch_to_clean = git_branch or fallback
                await git_ops_service.cleanup_branch(branch_to_clean)

            # Cache invalidation is decoupled from git outcome: vault writes have
            # already happened, so cached context is stale whether or not the PR
            # step succeeded.
            try:
                await invalidate_context_cache()
            except Exception:
                log.warning("light_dream.cache_invalidation_failed", dream_id=dream_id)

        # Step 9: Update dream row
        duration_ms = time.monotonic_ns() // 1_000_000 - start_ms
        outcome = _determine_light_dream_outcome(
            extraction_failed=extraction_failed,
            summary=summary,
            record_raised=record_raised,
            files_modified=files_modified,
        )
        outcome = _apply_yield_check(
            outcome=outcome,
            dream_id=dream_id,
            total_tokens=usage_total_tokens,
            tool_calls=usage_tool_calls,
            session_log=session_log,
        )
        async with async_session_factory() as session:
            dream_result = await session.execute(select(Dream).where(Dream.id == dream_id))
            d: Dream = dream_result.scalar_one()
            d.outcome = outcome
            if extraction_failed:
                d.status = "failed"
                d.error_message = error_message
            elif is_partial:
                d.status = "partial"
                d.error_message = error_message
            else:
                d.status = "completed"
            d.duration_ms = duration_ms
            d.completed_at = datetime.now(UTC)
            if files_modified:
                d.files_modified = files_modified  # type: ignore[assignment]
            if git_branch is not None:
                d.git_branch = git_branch
            if git_pr_url is not None:
                d.git_pr_url = git_pr_url
            if git_pr_status is not None:
                d.git_pr_status = git_pr_status
            d.input_tokens = usage_input_tokens
            d.output_tokens = usage_output_tokens
            d.total_tokens = usage_total_tokens
            d.tool_calls = usage_tool_calls
            await session.commit()

        # Step 10: Update transcript status
        async with async_session_factory() as session:
            t_result = await session.execute(
                select(Transcript).where(Transcript.id == transcript_id)
            )
            t2: Transcript = t_result.scalar_one()
            t2.status = "failed" if extraction_failed else "processed"
            if not extraction_failed and t2.segment_end_line > 0:
                t2.last_processed_line = t2.segment_end_line
            await session.commit()

        if extraction_failed:
            log.error(
                "light_dream.failed",
                transcript_id=transcript_id,
                dream_id=dream_id,
                duration_ms=duration_ms,
                outcome=outcome,
            )
        elif is_partial:
            log.warning(
                "light_dream.partial",
                transcript_id=transcript_id,
                dream_id=dream_id,
                memories_count=memories_count,
                duration_ms=duration_ms,
                outcome=outcome,
            )
        else:
            log.info(
                "light_dream.completed",
                transcript_id=transcript_id,
                dream_id=dream_id,
                memories_count=memories_count,
                duration_ms=duration_ms,
                outcome=outcome,
            )

    finally:
        if transcript_path.exists():
            transcript_path.unlink()
        shutil.rmtree(workspace, ignore_errors=True)
