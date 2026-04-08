import time
from datetime import UTC, date, datetime
from typing import Any

from pydantic_ai.exceptions import UsageLimitExceeded
from sqlalchemy import select

from app.core.exceptions import DreamError
from app.core.logging import get_logger
from app.models.db import async_session_factory
from app.models.tables import Dream
from app.services.context_cache import invalidate_context_cache
from app.services.deep_dream import (
    align_memu_with_memory,
    gather_consolidation_inputs,
    validate_consolidated_output,
    write_consolidated_files,
)
from app.services.dream_agent import (
    DeepDreamDeps,
    consolidation_to_dict,
    run_deep_dream_consolidation,
    run_phase1_light_sleep,
)
from app.services.git_ops import git_ops_service
from app.services.memory_files import read_vault_file, write_vault_file
from app.services.vault_updater import update_file_manifest, update_vault_folders

log = get_logger("jarvis.tasks.deep_dream")


async def _backup_files(source_date: date) -> None:
    memory_md = await read_vault_file("MEMORY.md")
    if memory_md:
        await write_vault_file(
            f".backups/MEMORY.md.{source_date.isoformat()}.bak", memory_md
        )
    daily_log = await read_vault_file(f"dailys/{source_date.isoformat()}.md")
    if daily_log:
        await write_vault_file(
            f".backups/dailys-{source_date.isoformat()}.bak", daily_log
        )


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

    # Step 2b: Backup MEMORY.md and daily log
    try:
        await _backup_files(source_date)
    except Exception as exc:
        log.warning("deep_dream.backup.failed", dream_id=dream_id, error=str(exc))

    # Step 2c: Phase 1 — Light Sleep (inventory & dedup)
    phase1_deps = DeepDreamDeps(
        source_date=source_date,
        memu_memories=memu_memories,
        memory_md=memory_md,
        daily_log=daily_log,
        soul_md=soul_md,
    )
    try:
        phase1_output, phase1_usage, phase1_tool_calls = await run_phase1_light_sleep(
            phase1_deps
        )
        log.info(
            "deep_dream.phase1.completed",
            dream_id=dream_id,
            candidates=len(phase1_output.candidates),
            duplicates_removed=phase1_output.duplicates_removed,
            contradictions_found=phase1_output.contradictions_found,
            total_tokens=phase1_usage.total_tokens,
            tool_calls=phase1_tool_calls,
        )
    except Exception as exc:
        log.error("deep_dream.phase1.failed", dream_id=dream_id, error=str(exc))
        await _mark_failed(dream_id, f"Phase 1 failed: {exc}", start_ms)
        return

    if not phase1_output.candidates:
        log.info("deep_dream.phase1.skipped", dream_id=dream_id, reason="no_candidates")
        await _mark_skipped(dream_id, start_ms)
        return

    # Step 3: PydanticAI consolidation agent
    consolidation_result: dict[str, Any] | None = None
    is_partial = False
    usage_input_tokens: int | None = None
    usage_output_tokens: int | None = None
    usage_total_tokens: int | None = None
    usage_tool_calls: int | None = None
    try:
        deps = DeepDreamDeps(
            source_date=source_date,
            memu_memories=memu_memories,
            memory_md=memory_md,
            daily_log=daily_log,
            soul_md=soul_md,
        )
        output, usage, tool_call_count = await run_deep_dream_consolidation(deps)
        consolidation_result = consolidation_to_dict(output)
        usage_input_tokens = usage.request_tokens
        usage_output_tokens = usage.response_tokens
        usage_total_tokens = usage.total_tokens
        usage_tool_calls = tool_call_count
        log.info(
            "deep_dream.usage",
            dream_id=dream_id,
            input_tokens=usage_input_tokens,
            output_tokens=usage_output_tokens,
            total_tokens=usage_total_tokens,
            tool_calls=usage_tool_calls,
        )
    except UsageLimitExceeded as exc:
        is_partial = True
        log.warning(
            "deep_dream.consolidation.partial",
            dream_id=dream_id,
            error=str(exc),
        )
    except (DreamError, Exception) as exc:
        log.error("deep_dream.consolidation.failed", dream_id=dream_id, error=str(exc))
        await _mark_failed(dream_id, str(exc), start_ms)
        return

    if consolidation_result is None:
        await _mark_failed(dream_id, "consolidation produced no output", start_ms)
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
        vault_updates.get(f)
        for f in (
            "decisions", "projects", "patterns", "templates",
            "concepts", "connections", "lessons",
        )
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
        git_result = await git_ops_service.create_deep_dream_pr(
            files_modified,  # type: ignore[arg-type]
            dream_id,
            source_date,
            stats,
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
            await git_ops_service.cleanup_branch(branch_name)

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
        d.status = "partial" if is_partial else "completed"
        d.memories_extracted = stats.get("total_memories_processed", 0)
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
