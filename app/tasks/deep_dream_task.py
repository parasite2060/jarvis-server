import time
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import select

from app.core.exceptions import DreamError
from app.core.logging import get_logger
from app.models.db import async_session_factory
from app.models.tables import Dream
from app.services.azure_openai import consolidate_memories
from app.services.context_cache import invalidate_context_cache
from app.services.deep_dream import (
    align_memu_with_memory,
    gather_consolidation_inputs,
    validate_consolidated_output,
    write_consolidated_files,
)
from app.services.git_ops import cleanup_branch, create_deep_dream_pr
from app.services.vault_updater import update_file_manifest, update_vault_folders

log = get_logger("jarvis.tasks.deep_dream")


async def deep_dream_task(ctx: dict[str, Any], trigger: str = "auto") -> None:
    log.info("deep_dream.started", trigger=trigger)
    start_ms = time.monotonic_ns() // 1_000_000

    source_date = date.today()

    # Step 1: Create dream row
    dream = Dream(
        type="deep",
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

    # Step 2: Gather inputs
    inputs: dict[str, Any] | None = None
    try:
        inputs = await gather_consolidation_inputs(source_date)
    except Exception as exc:
        log.error("deep_dream.gather.failed", dream_id=dream_id, error=str(exc))
        await _mark_failed(dream_id, str(exc), start_ms)
        return

    if inputs is None:
        log.info("deep_dream.skipped", dream_id=dream_id, reason="no_memories")
        await _mark_skipped(dream_id, start_ms)
        return

    memu_memories: list[dict[str, Any]] = inputs["memu_memories"]
    memory_md: str = inputs["memory_md"]
    daily_log: str = inputs["daily_log"]
    soul_md: str = inputs["soul_md"]

    # Step 3: Call GPT-5.2 consolidation
    consolidation_result: dict[str, Any] | None = None
    try:
        consolidation_result = await consolidate_memories(
            memory_md, daily_log, soul_md, memu_memories
        )
    except DreamError as exc:
        log.error("deep_dream.consolidation.failed", dream_id=dream_id, error=str(exc))
        await _mark_failed(dream_id, str(exc), start_ms)
        return

    # Step 4: Validate output
    validated: dict[str, Any] | None = None
    try:
        validated = await validate_consolidated_output(consolidation_result)
    except (ValueError, KeyError) as exc:
        log.error("deep_dream.validation.failed", dream_id=dream_id, error=str(exc))
        await _mark_failed(dream_id, str(exc), start_ms)
        return

    # Step 5: Write files (DESTRUCTIVE)
    files_modified: list[dict[str, str]] | None = None
    try:
        files_modified = await write_consolidated_files(validated, source_date)
    except Exception as exc:
        log.error("deep_dream.files.failed", dream_id=dream_id, error=str(exc))
        await _mark_failed(dream_id, str(exc), start_ms)
        return

    # Step 6b: Update vault folders
    vault_updates: dict[str, list[dict[str, Any]]] | None = consolidation_result.get(
        "vault_updates"
    )
    has_vault_content = vault_updates is not None and any(
        vault_updates.get(f) for f in ("decisions", "projects", "patterns", "templates")
    )
    if has_vault_content and vault_updates is not None:
        try:
            vault_files = await update_vault_folders(vault_updates, source_date)
            files_modified.extend(vault_files)
        except Exception as exc:
            log.error("deep_dream.vault.failed", dream_id=dream_id, error=str(exc))

    # Step 6c: Update file_manifest for ALL modified files
    try:
        await update_file_manifest(files_modified)
    except Exception as exc:
        log.warning("deep_dream.manifest.failed", dream_id=dream_id, error=str(exc))

    # Step 7: Git branch and PR
    stats = consolidation_result.get("stats", {})
    git_result: dict[str, str] = {"git_branch": "", "git_pr_url": "", "git_pr_status": ""}
    branch_name: str = ""
    try:
        git_result = await create_deep_dream_pr(
            files_modified, dream_id, source_date, stats  # type: ignore[arg-type]
        )
        branch_name = git_result.get("git_branch", "")
        if git_result.get("git_pr_url"):
            try:
                await invalidate_context_cache()
            except Exception as exc:
                log.warning("deep_dream.cache_invalidate.failed", error=str(exc))
    except Exception as exc:
        log.error("deep_dream.git.failed", dream_id=dream_id, error=str(exc))
    finally:
        if branch_name:
            await cleanup_branch(branch_name)

    # Step 8: MemU alignment
    memu_sync: dict[str, int] = {"items_synced": 0, "errors": 0}
    try:
        memu_sync = await align_memu_with_memory(validated["memory_md"], source_date)
    except Exception as exc:
        log.error("deep_dream.memu_align.failed", dream_id=dream_id, error=str(exc))

    # Step 9: Update dream row
    duration_ms = time.monotonic_ns() // 1_000_000 - start_ms
    input_summary = (
        f"memu_count={len(memu_memories)}, "
        f"memory_md_len={len(memory_md)}, "
        f"daily_log_len={len(daily_log)}"
    )
    output_raw = (
        f"line_count={validated.get('line_count', 0)}, "
        f"total_processed={stats.get('total_memories_processed', 0)}, "
        f"duplicates={stats.get('duplicates_removed', 0)}, "
        f"contradictions={stats.get('contradictions_resolved', 0)}"
    )

    async with async_session_factory() as session:
        result = await session.execute(select(Dream).where(Dream.id == dream_id))
        d: Dream = result.scalar_one()
        d.status = "completed"
        d.memories_extracted = stats.get("total_memories_processed", 0)
        d.duration_ms = duration_ms
        d.completed_at = datetime.now(UTC)
        d.files_modified = files_modified  # type: ignore[assignment]
        d.git_branch = git_result.get("git_branch", "")
        d.git_pr_url = git_result.get("git_pr_url", "")
        d.git_pr_status = git_result.get("git_pr_status", "")
        d.input_summary = input_summary
        d.output_raw = output_raw
        await session.commit()

    log.info(
        "deep_dream.completed",
        dream_id=dream_id,
        trigger=trigger,
        duration_ms=duration_ms,
        memories_extracted=stats.get("total_memories_processed", 0),
        files_count=len(files_modified),
        git_pr_url=git_result.get("git_pr_url", ""),
        memu_synced=memu_sync.get("items_synced", 0),
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
    log.error("deep_dream.failed", dream_id=dream_id, duration_ms=duration_ms)


async def _mark_skipped(dream_id: int, start_ms: int) -> None:
    duration_ms = time.monotonic_ns() // 1_000_000 - start_ms
    async with async_session_factory() as session:
        result = await session.execute(select(Dream).where(Dream.id == dream_id))
        d: Dream = result.scalar_one()
        d.status = "skipped"
        d.duration_ms = duration_ms
        d.completed_at = datetime.now(UTC)
        await session.commit()
    log.info("deep_dream.skipped", dream_id=dream_id, duration_ms=duration_ms)
