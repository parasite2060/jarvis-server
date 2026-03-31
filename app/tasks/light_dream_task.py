import time
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import select

from app.core.exceptions import DreamError
from app.core.logging import get_logger
from app.models.db import async_session_factory
from app.models.tables import Dream, ExtractedMemory, Transcript
from app.services.azure_openai import extract_memories
from app.services.context_cache import invalidate_context_cache
from app.services.git_ops import cleanup_branch, create_dream_pr
from app.services.memory_updater import MemoryItem, update_memory_files
from app.services.memu_client import memu_memorize

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

    # Step 4: Call GPT-5.2 extraction
    extraction_result: dict[str, Any] | None = None
    extraction_failed = False
    error_message: str | None = None

    try:
        extraction_result = await extract_memories(transcript.parsed_text or "")
        log.info(
            "light_dream.extraction.completed",
            transcript_id=transcript_id,
            dream_id=dream_id,
        )
    except DreamError as exc:
        extraction_failed = True
        error_message = str(exc)
        log.error(
            "light_dream.extraction.failed",
            transcript_id=transcript_id,
            dream_id=dream_id,
            error=error_message,
        )

    # Step 5: Store extracted memories (skip if extraction failed or NO_EXTRACT)
    memories_count = 0
    source_date_for_git = date.today()
    if extraction_result is not None and not extraction_result.get("no_extract", False):
        async with async_session_factory() as session:
            for category in MEMORY_CATEGORIES:
                items = extraction_result.get(category, [])
                for item in items:
                    source_date_str = item.get("source_date", "")
                    try:
                        source_date_val = date.fromisoformat(source_date_str)
                    except (ValueError, TypeError):
                        source_date_val = date.today()

                    memory = ExtractedMemory(
                        dream_id=dream_id,
                        type=category,
                        content=item.get("content", ""),
                        reasoning=item.get("reasoning"),
                        vault_target=item.get("vault_target"),
                        source_date=source_date_val,
                    )
                    session.add(memory)
                    memories_count += 1
            await session.commit()

        log.info(
            "light_dream.memories_stored",
            transcript_id=transcript_id,
            dream_id=dream_id,
            memories_count=memories_count,
        )

    # Step 5b: Update memory files
    files_modified: list[dict[str, object]] | None = None
    if extraction_result is not None and not extraction_result.get("no_extract", False):
        try:
            memory_items: list[MemoryItem] = []
            for category in MEMORY_CATEGORIES:
                items = extraction_result.get(category, [])
                for item in items:
                    memory_items.append(
                        MemoryItem(
                            type=category.rstrip("s"),
                            content=item.get("content", ""),
                            reasoning=item.get("reasoning"),
                            vault_target=item.get("vault_target"),
                        )
                    )

            source_date_str = ""
            for category in MEMORY_CATEGORIES:
                items = extraction_result.get(category, [])
                if items:
                    source_date_str = items[0].get("source_date", "")
                    break
            try:
                source_date_val = date.fromisoformat(source_date_str)
            except (ValueError, TypeError):
                source_date_val = date.today()

            source_date_for_git = source_date_val
            summary = extraction_result.get("summary", "")
            files_modified = await update_memory_files(
                dream_id, memory_items, summary, source_date_val
            )
            log.info(
                "light_dream.files_updated",
                transcript_id=transcript_id,
                dream_id=dream_id,
                files_count=len(files_modified),
            )
        except Exception as exc:
            log.warning(
                "light_dream.files_update_failed",
                transcript_id=transcript_id,
                dream_id=dream_id,
                error=str(exc),
            )

    # Step 6: Store to MemU (fire-and-forget, don't fail the pipeline)
    try:
        messages = [{"role": "user", "content": transcript.parsed_text or ""}]
        await memu_memorize(messages)
        log.info(
            "light_dream.memu_stored",
            transcript_id=transcript_id,
            dream_id=dream_id,
        )
    except Exception as exc:
        log.warning(
            "light_dream.memu_failed",
            transcript_id=transcript_id,
            dream_id=dream_id,
            error=str(exc),
        )

    # Step 6b: Git branch and PR
    git_branch: str | None = None
    git_pr_url: str | None = None
    git_pr_status: str | None = None

    if files_modified is not None and len(files_modified) > 0:
        source_time = dream.started_at.strftime("%H%M%S") if dream.started_at else "000000"

        try:
            git_result = await create_dream_pr(
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
            # Invalidate context cache after successful PR
            try:
                await invalidate_context_cache()
            except Exception:
                log.warning("light_dream.cache_invalidation_failed", dream_id=dream_id)
        except Exception as exc:
            log.warning(
                "light_dream.git_ops_failed",
                dream_id=dream_id,
                error=str(exc),
            )
        finally:
            branch_to_clean = git_branch or f"dream/light-{date.today().isoformat()}-{source_time}"
            await cleanup_branch(branch_to_clean)

    # Step 7: Update dream row
    duration_ms = time.monotonic_ns() // 1_000_000 - start_ms

    async with async_session_factory() as session:
        dream_result = await session.execute(select(Dream).where(Dream.id == dream_id))
        d: Dream = dream_result.scalar_one()
        if extraction_failed:
            d.status = "failed"
            d.error_message = error_message
        else:
            d.status = "completed"
        d.memories_extracted = memories_count
        d.duration_ms = duration_ms
        d.completed_at = datetime.now(UTC)
        if files_modified is not None:
            d.files_modified = files_modified  # type: ignore[assignment]
        if git_branch is not None:
            d.git_branch = git_branch
        if git_pr_url is not None:
            d.git_pr_url = git_pr_url
        if git_pr_status is not None:
            d.git_pr_status = git_pr_status
        await session.commit()

    # Step 8: Update transcript status
    async with async_session_factory() as session:
        t_result = await session.execute(select(Transcript).where(Transcript.id == transcript_id))
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
    else:
        log.info(
            "light_dream.completed",
            transcript_id=transcript_id,
            dream_id=dream_id,
            memories_count=memories_count,
            duration_ms=duration_ms,
        )
