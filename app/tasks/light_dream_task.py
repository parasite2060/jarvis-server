import shutil
import tempfile
import time
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

from pydantic_ai.exceptions import UsageLimitExceeded
from sqlalchemy import select

from app.core.exceptions import DreamError
from app.core.logging import get_logger
from app.models.db import async_session_factory
from app.models.tables import Dream, ExtractedMemory, Transcript
from app.services.context_cache import invalidate_context_cache
from app.services.dream_agent import DreamDeps, MergeDeps, run_dream_extraction, run_merge
from app.services.git_ops import git_ops_service

log = get_logger("jarvis.tasks.light_dream")

MEMORY_CATEGORIES = ("decisions", "preferences", "patterns", "corrections", "facts")


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

    # Step 4: Write transcript to temp workspace
    parsed_text = transcript.parsed_text or ""
    workspace = Path(tempfile.mkdtemp(prefix=f"dream-{dream_id}-", dir="/tmp/jarvis-dreams"))

    extraction_failed = False
    is_partial = False
    error_message: str | None = None
    memories_count = 0
    source_date_for_git = date.today()
    files_modified: list[dict[str, object]] = []
    usage_input_tokens: int | None = None
    usage_output_tokens: int | None = None
    usage_total_tokens: int | None = None
    usage_tool_calls: int | None = None

    try:
        (workspace / "transcript.txt").write_text(parsed_text, encoding="utf-8")

        # Step 5: Run extraction agent
        deps = DreamDeps(
            transcript_id=transcript_id,
            workspace=workspace,
            extracted_memories=[],
            session_id=str(transcript.session_id) if hasattr(transcript, "session_id") else "",
            project=getattr(transcript, "project", None),
            token_count=getattr(transcript, "token_count", None),
            created_at=getattr(transcript, "created_at", None),
        )

        try:
            summary, usage, tool_calls = await run_dream_extraction(deps)
            usage_input_tokens = getattr(usage, "request_tokens", None)
            usage_output_tokens = getattr(usage, "response_tokens", None)
            usage_total_tokens = getattr(usage, "total_tokens", None)
            usage_tool_calls = tool_calls
            log.info(
                "light_dream.extraction.completed",
                transcript_id=transcript_id,
                dream_id=dream_id,
                memories_count=len(deps.extracted_memories),
            )
            log.info(
                "light_dream.usage",
                dream_id=dream_id,
                input_tokens=usage_input_tokens,
                output_tokens=usage_output_tokens,
                total_tokens=usage_total_tokens,
                tool_calls=usage_tool_calls,
            )
        except UsageLimitExceeded as exc:
            is_partial = True
            error_message = str(exc)
            log.warning(
                "light_dream.extraction.partial",
                transcript_id=transcript_id,
                dream_id=dream_id,
                error=error_message,
            )
        except (DreamError, Exception) as exc:
            extraction_failed = True
            error_message = str(exc)
            log.error(
                "light_dream.extraction.failed",
                transcript_id=transcript_id,
                dream_id=dream_id,
                error=error_message,
            )

        # Step 6: Store extracted memories to DB
        memories = deps.extracted_memories
        memories_count = len(memories)
        if memories_count > 0:
            async with async_session_factory() as session:
                for item in memories:
                    cat = item.vault_target
                    category = cat if cat in MEMORY_CATEGORIES else "facts"
                    try:
                        source_date_val = date.fromisoformat(item.source_date)
                    except (ValueError, TypeError):
                        source_date_val = date.today()
                    source_date_for_git = source_date_val

                    memory = ExtractedMemory(
                        dream_id=dream_id,
                        type=category,
                        content=item.content,
                        reasoning=item.reasoning,
                        vault_target=item.vault_target,
                        source_date=source_date_val,
                    )
                    session.add(memory)
                await session.commit()

            log.info(
                "light_dream.memories_stored",
                transcript_id=transcript_id,
                dream_id=dream_id,
                memories_count=memories_count,
            )

        # Step 7: Run merge agent (replaces memory_updater + memu_memorize)
        no_extract = extraction_failed or (
            hasattr(summary, "no_extract") and summary.no_extract
        )
        if not no_extract and memories_count > 0:
            try:
                from app.config import settings as app_settings

                merge_deps = MergeDeps(
                    workspace=Path(app_settings.jarvis_memory_path),
                    extracted_memories=memories,
                    source_date=source_date_for_git,
                    session_id=deps.session_id,
                    summary=summary.summary if hasattr(summary, "summary") else "",
                )
                merge_result, merge_usage, merge_tool_calls = await run_merge(merge_deps)
                files_modified = [{"path": f.path, "action": f.action} for f in merge_result.files]
                log.info(
                    "light_dream.merge.completed",
                    transcript_id=transcript_id,
                    dream_id=dream_id,
                    files_count=len(files_modified),
                    merge_summary=merge_result.summary,
                )
            except Exception as exc:
                log.warning(
                    "light_dream.merge.failed",
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
                try:
                    await invalidate_context_cache()
                except Exception:
                    log.warning("light_dream.cache_invalidation_failed", dream_id=dream_id)
            except Exception as exc:
                log.warning("light_dream.git_ops_failed", dream_id=dream_id, error=str(exc))
            finally:
                fallback = f"dream/light-{date.today().isoformat()}-{source_time}"
                branch_to_clean = git_branch or fallback
                await git_ops_service.cleanup_branch(branch_to_clean)

        # Step 9: Update dream row
        duration_ms = time.monotonic_ns() // 1_000_000 - start_ms
        async with async_session_factory() as session:
            dream_result = await session.execute(select(Dream).where(Dream.id == dream_id))
            d: Dream = dream_result.scalar_one()
            if extraction_failed:
                d.status = "failed"
                d.error_message = error_message
            elif is_partial:
                d.status = "partial"
                d.error_message = error_message
            else:
                d.status = "completed"
            d.memories_extracted = memories_count
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
            await session.commit()

        if extraction_failed:
            log.error(
                "light_dream.failed",
                transcript_id=transcript_id,
                dream_id=dream_id,
                duration_ms=duration_ms,
            )
        elif is_partial:
            log.warning(
                "light_dream.partial",
                transcript_id=transcript_id,
                dream_id=dream_id,
                memories_count=memories_count,
                duration_ms=duration_ms,
            )
        else:
            log.info(
                "light_dream.completed",
                transcript_id=transcript_id,
                dream_id=dream_id,
                memories_count=memories_count,
                duration_ms=duration_ms,
            )

    finally:
        shutil.rmtree(workspace, ignore_errors=True)
