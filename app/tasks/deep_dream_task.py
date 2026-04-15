import json
import time
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

from pydantic_ai.exceptions import UsageLimitExceeded
from sqlalchemy import select

from app.config import settings
from app.core.exceptions import DreamError
from app.core.logging import get_logger
from app.models.db import async_session_factory
from app.models.tables import Dream
from app.services.context_cache import invalidate_context_cache
from app.services.deep_dream import (
    align_memu_with_memory,
    calculate_candidate_score,
    gather_consolidation_inputs,
    run_health_checks,
    validate_consolidated_output,
    write_consolidated_files,
)
from app.services.dream_agent import (
    DeepDreamDeps,
    Phase2Deps,
    consolidation_to_dict,
    run_deep_dream_consolidation,
    run_health_fix,
    run_phase1_light_sleep,
    run_phase2_rem_sleep,
)
from app.services.dream_models import (
    HealthReport,
    LightSleepOutput,
    REMSleepOutput,
    ScoredCandidate,
)
from app.services.dream_telemetry import store_phase_telemetry
from app.services.git_ops import git_ops_service
from app.services.memory_files import append_vault_log, read_vault_file, write_vault_file
from app.services.vault_updater import update_file_manifest, update_vault_folders

log = get_logger("jarvis.tasks.deep_dream")


def _format_phase1_summary(
    phase1_output: LightSleepOutput,
    scores: dict[str, float],
) -> str:
    lines: list[str] = ["## Phase 1: Light Sleep Results"]
    lines.append("")
    lines.append("### Intent")
    lines.append("Inventory today's memories, deduplicate, flag contradictions.")
    lines.append("")
    lines.append("### Summary")
    lines.append(
        f"{len(phase1_output.candidates)} candidates after dedup "
        f"({phase1_output.duplicates_removed} removed). "
        f"{phase1_output.contradictions_found} contradictions."
    )
    lines.append("")

    # Classify candidates into actionable decisions
    promote: list[str] = []
    prune: list[str] = []
    contradiction: list[str] = []
    for c in phase1_output.candidates:
        score = round(scores.get(c.content, 0.0), 3)
        if c.contradiction_flag:
            contradiction.append(
                f"- CONTRADICTION: \"{c.content}\" ({c.category}, score={score})"
            )
        if score >= 0.7 and c.reinforcement_count >= 3:
            promote.append(
                f"- PROMOTE: \"{c.content}\" → Strong Patterns "
                f"(score={score}, {c.reinforcement_count}x)"
            )
        elif score < 0.2:
            prune.append(
                f"- PRUNE CANDIDATE: \"{c.content}\" (score={score})"
            )

    lines.append("### Actionable Decisions")
    if promote or prune or contradiction:
        lines.extend(promote)
        lines.extend(prune)
        lines.extend(contradiction)
    else:
        lines.append("No actionable decisions.")
    lines.append("")

    lines.append("### Scoring Config")
    lines.append(
        "Weights: frequency=0.25, recency=0.25, relevance=0.20, "
        "consistency=0.20, breadth=0.10"
    )
    lines.append(
        "Thresholds: promote >= 0.7 (3+ reinforced), prune < 0.2, decay=0.03"
    )
    lines.append("")

    # JSON reference with full candidate data
    ref_data = [
        {
            **c.model_dump(),
            "score": round(scores.get(c.content, 0.0), 3),
        }
        for c in phase1_output.candidates
    ]
    lines.append("### Reference Data")
    lines.append("```json")
    lines.append(json.dumps(ref_data, indent=2))
    lines.append("```")
    return "\n".join(lines)


def _format_phase1_for_phase2(
    candidates: list[ScoredCandidate],
    scores: dict[str, float],
) -> str:
    lines: list[str] = []
    for i, c in enumerate(candidates, 1):
        score = scores.get(c.content, 0.0)
        flag = " [CONTRADICTION]" if c.contradiction_flag else ""
        lines.append(
            f"[{i}] ({c.category}) {c.content} "
            f"[score={score:.2f}, reinforced={c.reinforcement_count}]{flag}"
        )
    return "\n".join(lines)


def _format_vault_indexes(vault_indexes: dict[str, str]) -> str:
    lines: list[str] = []
    for folder, content in vault_indexes.items():
        lines.append(f"### {folder}/")
        lines.append(content)
        lines.append("")
    return "\n".join(lines)


def _format_phase2_summary(phase2_output: REMSleepOutput) -> str:
    lines: list[str] = ["## Phase 2: REM Sleep Results"]
    lines.append("")
    lines.append("### Intent")
    lines.append("Cross-session pattern detection, connection discovery, gap analysis.")
    lines.append("")

    lines.append("### Themes")
    if phase2_output.themes:
        for t in phase2_output.themes:
            evidence = ", ".join(t.evidence) if t.evidence else "n/a"
            lines.append(
                f"- \"{t.topic}\" — {t.session_count} sessions. Evidence: {evidence}"
            )
    else:
        lines.append("No themes detected.")
    lines.append("")

    lines.append("### Connection Candidates")
    if phase2_output.new_connections:
        for c in phase2_output.new_connections:
            lines.append(
                f"- {c.concept_a} <-[{c.relationship_type}]-> {c.concept_b}: "
                f"{c.relationship}"
            )
    else:
        lines.append("No new connections.")
    lines.append("")

    lines.append("### Promotion Candidates")
    if phase2_output.promotion_candidates:
        for p in phase2_output.promotion_candidates:
            lines.append(f"- {p.source_file} → {p.target_folder}: {p.reason}")
    else:
        lines.append("No promotions.")
    lines.append("")

    lines.append("### Knowledge Gaps")
    if phase2_output.gaps:
        for g in phase2_output.gaps:
            files = ", ".join(g.mentioned_in_files) if g.mentioned_in_files else "n/a"
            lines.append(f"- \"{g.concept}\" — mentioned in: {files}")
    else:
        lines.append("No gaps detected.")
    lines.append("")

    # JSON reference with full model data
    ref_data = {
        "themes": [t.model_dump() for t in phase2_output.themes],
        "connections": [c.model_dump() for c in phase2_output.new_connections],
        "promotions": [p.model_dump() for p in phase2_output.promotion_candidates],
        "gaps": [g.model_dump() for g in phase2_output.gaps],
    }
    lines.append("### Reference Data")
    lines.append("```json")
    lines.append(json.dumps(ref_data, indent=2))
    lines.append("```")
    return "\n".join(lines)


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
    phase1_run_prompt = (
        "Inventory, deduplicate, and score today's memories.\n"
        "Use query_memu_memories() for MemU data.\n\n"
        f"## Current MEMORY.md\n{memory_md or '(empty)'}\n\n"
        f"## Today's Daily Log\n{daily_log or '(empty)'}"
    )
    phase1_start = time.monotonic_ns() // 1_000_000
    phase1_started_at = datetime.now(UTC)
    try:
        phase1_output, phase1_usage, phase1_tool_calls, phase1_messages = (
            await run_phase1_light_sleep(phase1_deps)
        )
        phase1_duration_ms = time.monotonic_ns() // 1_000_000 - phase1_start
        log.info(
            "deep_dream.phase1.completed",
            dream_id=dream_id,
            candidates=len(phase1_output.candidates),
            duplicates_removed=phase1_output.duplicates_removed,
            contradictions_found=phase1_output.contradictions_found,
            total_tokens=phase1_usage.total_tokens,
            tool_calls=phase1_tool_calls,
        )
        await store_phase_telemetry(
            dream_id=dream_id,
            phase="phase1_light_sleep",
            status="completed",
            run_prompt=phase1_run_prompt,
            output_json=phase1_output.model_dump(),
            messages=phase1_messages,
            usage=phase1_usage,
            tool_calls=phase1_tool_calls,
            duration_ms=phase1_duration_ms,
            started_at=phase1_started_at,
        )
    except Exception as exc:
        phase1_duration_ms = time.monotonic_ns() // 1_000_000 - phase1_start
        log.error("deep_dream.phase1.failed", dream_id=dream_id, error=str(exc))
        await store_phase_telemetry(
            dream_id=dream_id,
            phase="phase1_light_sleep",
            status="failed",
            run_prompt=phase1_run_prompt,
            duration_ms=phase1_duration_ms,
            error_message=str(exc),
        )
        await _mark_failed(dream_id, f"Phase 1 failed: {exc}", start_ms)
        return

    if not phase1_output.candidates:
        log.info("deep_dream.phase1.skipped", dream_id=dream_id, reason="no_candidates")
        await _mark_skipped(dream_id, start_ms)
        return

    # Step 2d: Compute scores for Phase 1 candidates (deterministic Python)
    candidate_scores: dict[str, float] = {}
    for candidate in phase1_output.candidates:
        candidate_scores[candidate.content] = calculate_candidate_score(
            reinforcement_count=candidate.reinforcement_count,
            days_since_reinforced=0,
            in_active_project=True,
            has_contradiction=candidate.contradiction_flag,
            context_count=len(candidate.source_sessions),
        )

    # Step 2e: Phase 2 — REM Sleep (cross-session pattern detection)
    phase2_start = time.monotonic_ns() // 1_000_000
    phase2_started_at = datetime.now(UTC)
    try:
        daily_logs: dict[str, str] = {}
        for i in range(7):
            d = source_date - timedelta(days=i)
            content = await read_vault_file(f"dailys/{d.isoformat()}.md")
            if content:
                daily_logs[d.isoformat()] = content

        vault_index_folders = (
            "decisions", "patterns", "concepts", "connections", "lessons", "projects",
        )
        vault_indexes: dict[str, str] = {}
        for folder in vault_index_folders:
            content = await read_vault_file(f"{folder}/_index.md")
            if content:
                vault_indexes[folder] = content

        phase1_for_phase2 = _format_phase1_for_phase2(
            phase1_output.candidates, candidate_scores
        )
        vault_index_text = _format_vault_indexes(vault_indexes)
        phase2_deps = Phase2Deps(
            source_date=source_date,
            daily_logs=daily_logs,
            vault_indexes=vault_indexes,
            phase1_candidates=phase1_output.candidates,
            phase1_text=phase1_for_phase2,
            vault_index_text=vault_index_text,
        )
        phase2_run_prompt = (
            "Analyze cross-session patterns and detect themes, connections, gaps.\n"
            "Use read_daily_log(date_str) to read specific daily logs.\n\n"
            f"## Phase 1 Candidates\n{phase1_for_phase2 or 'No Phase 1 candidates.'}\n\n"
            f"## Vault Indexes\n{vault_index_text or 'No vault indexes available.'}"
        )
        phase2_output, phase2_usage, phase2_tool_calls, phase2_messages = (
            await run_phase2_rem_sleep(phase2_deps)
        )
        phase2_duration_ms = time.monotonic_ns() // 1_000_000 - phase2_start
        log.info(
            "deep_dream.phase2.completed",
            dream_id=dream_id,
            themes=len(phase2_output.themes),
            new_connections=len(phase2_output.new_connections),
            promotion_candidates=len(phase2_output.promotion_candidates),
            gaps=len(phase2_output.gaps),
            total_tokens=phase2_usage.total_tokens,
            tool_calls=phase2_tool_calls,
        )
        await store_phase_telemetry(
            dream_id=dream_id,
            phase="phase2_rem_sleep",
            status="completed",
            run_prompt=phase2_run_prompt,
            output_json=phase2_output.model_dump(),
            messages=phase2_messages,
            usage=phase2_usage,
            tool_calls=phase2_tool_calls,
            duration_ms=phase2_duration_ms,
            started_at=phase2_started_at,
        )
        phase2_result: REMSleepOutput | None = phase2_output
    except Exception as exc:
        phase2_duration_ms = time.monotonic_ns() // 1_000_000 - phase2_start
        phase2_result = None
        log.warning("deep_dream.phase2.failed", dream_id=dream_id, error=str(exc))
        await store_phase_telemetry(
            dream_id=dream_id,
            phase="phase2_rem_sleep",
            status="failed",
            duration_ms=phase2_duration_ms,
            error_message=str(exc),
        )

    # Step 2f: Format Phase 1+2 summaries for consolidation agent (Phase 3)
    phase1_text = _format_phase1_summary(phase1_output, candidate_scores)
    phase2_text = _format_phase2_summary(phase2_result) if phase2_result else ""

    # Step 3: PydanticAI consolidation agent (Phase 3 — Deep Sleep)
    phase3_run_prompt = (
        "Consolidate memories. Produce updated MEMORY.md, daily summary, and vault updates.\n\n"
        f"{phase1_text}\n\n{phase2_text}\n\n"
        f"## Current MEMORY.md\n{memory_md or '(empty)'}\n\n"
        f"## Today's Daily Log\n{daily_log or '(empty)'}"
    )
    consolidation_result: dict[str, Any] | None = None
    consolidation_messages: list[Any] = []
    is_partial = False
    usage_input_tokens: int | None = None
    usage_output_tokens: int | None = None
    usage_total_tokens: int | None = None
    usage_tool_calls: int | None = None
    phase3_start = time.monotonic_ns() // 1_000_000
    phase3_started_at = datetime.now(UTC)
    try:
        deps = DeepDreamDeps(
            source_date=source_date,
            memu_memories=memu_memories,
            memory_md=memory_md,
            daily_log=daily_log,
            soul_md=soul_md,
            phase1_summary=phase1_text,
            phase2_summary=phase2_text,
        )
        output, usage, tool_call_count, consolidation_messages = (
            await run_deep_dream_consolidation(deps)
        )
        phase3_duration_ms = time.monotonic_ns() // 1_000_000 - phase3_start
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
        await store_phase_telemetry(
            dream_id=dream_id,
            phase="phase3_deep_sleep",
            status="completed",
            run_prompt=phase3_run_prompt,
            output_json=consolidation_result,
            messages=consolidation_messages,
            usage=usage,
            tool_calls=tool_call_count,
            duration_ms=phase3_duration_ms,
            started_at=phase3_started_at,
        )
    except UsageLimitExceeded as exc:
        phase3_duration_ms = time.monotonic_ns() // 1_000_000 - phase3_start
        is_partial = True
        log.warning(
            "deep_dream.consolidation.partial",
            dream_id=dream_id,
            error=str(exc),
        )
        await store_phase_telemetry(
            dream_id=dream_id,
            phase="phase3_deep_sleep",
            status="failed",
            run_prompt=phase3_run_prompt,
            duration_ms=phase3_duration_ms,
            error_message=str(exc),
        )
    except (DreamError, Exception) as exc:
        phase3_duration_ms = time.monotonic_ns() // 1_000_000 - phase3_start
        log.error("deep_dream.consolidation.failed", dream_id=dream_id, error=str(exc))
        await store_phase_telemetry(
            dream_id=dream_id,
            phase="phase3_deep_sleep",
            status="failed",
            run_prompt=phase3_run_prompt,
            duration_ms=phase3_duration_ms,
            error_message=str(exc),
        )
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

    # Step 6c2: Append to vault log
    try:
        for fm in files_modified:
            path = fm.get("path", "") if isinstance(fm, dict) else str(fm)
            action = fm.get("action", "update") if isinstance(fm, dict) else "update"
            if action == "create":
                await append_vault_log("create", str(path))
            else:
                await append_vault_log("update", str(path))
    except Exception as exc:
        log.warning("deep_dream.vault_log.failed", dream_id=dream_id, error=str(exc))

    # Step 6d: Health checks (deterministic Python post-processing)
    health_report: HealthReport | None = None
    try:
        knowledge_gap_names = (
            [g.concept for g in phase2_result.gaps] if phase2_result else []
        )
        workspace = Path(settings.jarvis_memory_path)
        health_report = await run_health_checks(
            workspace, knowledge_gaps=knowledge_gap_names
        )
        log.info(
            "deep_dream.health_check.completed",
            dream_id=dream_id,
            total_issues=health_report.total_issues,
            orphans=len(health_report.orphan_notes),
            stale=len(health_report.stale_notes),
            missing_fm=len(health_report.missing_frontmatter),
            contradictions=len(health_report.unresolved_contradictions),
            memory_overflow=health_report.memory_overflow,
            gaps=len(health_report.knowledge_gaps),
        )
    except Exception as exc:
        log.warning("deep_dream.health_check.failed", dream_id=dream_id, error=str(exc))

    if health_report is not None and health_report.total_issues > 0:
        try:
            await append_vault_log(
                "lint",
                f"Health check: {len(health_report.orphan_notes)} orphans, "
                f"{len(health_report.stale_notes)} stale, "
                f"{len(health_report.unresolved_contradictions)} contradictions",
            )
        except Exception:
            pass

    # Step 6e: Agent-based health fix (same session as consolidation for context)
    if health_report is not None and health_report.total_issues > 0 and consolidation_messages:
        try:
            # Build health summary for the agent
            issues: list[str] = []
            for entry in health_report.missing_backlinks:
                issues.append(f"- Missing backlink: {entry}")
            for entry in health_report.orphan_notes:
                issues.append(f"- Orphan note (not in _index.md): {entry}")
            for entry in health_report.missing_frontmatter:
                issues.append(f"- Missing YAML frontmatter: {entry}")
            for entry in health_report.unresolved_contradictions:
                issues.append(f"- Unresolved contradiction: {entry}")
            for entry in health_report.knowledge_gaps:
                issues.append(f"- Knowledge gap (concept referenced but no note): {entry}")

            if issues:
                health_summary = "\n".join(issues)
                deps_for_fix = DeepDreamDeps(
                    source_date=source_date,
                    memu_memories=memu_memories,
                    memory_md=memory_md,
                    daily_log=daily_log,
                    soul_md=soul_md,
                    phase1_summary=phase1_text,
                    phase2_summary=phase2_text,
                )
                health_fix_start = time.monotonic_ns() // 1_000_000
                health_fix_started_at = datetime.now(UTC)
                fix_usage, fix_tool_calls, health_fix_messages = await run_health_fix(
                    deps_for_fix, consolidation_messages, health_summary
                )
                health_fix_duration_ms = time.monotonic_ns() // 1_000_000 - health_fix_start
                log.info(
                    "deep_dream.health_fix.completed",
                    dream_id=dream_id,
                    fix_tokens=fix_usage.total_tokens,
                    fix_tool_calls=fix_tool_calls,
                    issues_sent=len(issues),
                )
                await store_phase_telemetry(
                    dream_id=dream_id,
                    phase="health_fix",
                    status="completed",
                    run_prompt=health_summary,
                    messages=health_fix_messages,
                    usage=fix_usage,
                    tool_calls=fix_tool_calls,
                    duration_ms=health_fix_duration_ms,
                    started_at=health_fix_started_at,
                )
                await append_vault_log(
                    "update",
                    f"Health fix: sent {len(issues)} issues to consolidation agent",
                )
                # Update file manifest after fixes
                try:
                    await update_file_manifest(files_modified)
                except Exception:
                    pass
        except Exception as exc:
            log.warning(
                "deep_dream.health_fix.failed",
                dream_id=dream_id,
                error=str(exc),
            )

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
    output_parts = [
        f"line_count={validated.get('line_count', 0)}",
        f"total_processed={stats.get('total_memories_processed', 0)}",
        f"duplicates={stats.get('duplicates_removed', 0)}",
        f"contradictions={stats.get('contradictions_resolved', 0)}",
    ]
    if health_report is not None:
        output_parts.append(
            f"health_report={json.dumps(health_report.model_dump())}"
        )
    output_raw = ", ".join(output_parts)

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
