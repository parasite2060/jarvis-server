from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any

from temporalio import activity

from app.activities.deep._models import HealthFixInput, HealthFixResult
from app.config import settings
from app.services.deep_dream import (
    auto_fix_health_issues,
    run_health_checks,
)
from app.services.dream_agent import DeepDreamDeps, run_health_fix
from app.services.dream_models import HealthReport
from app.services.dream_telemetry import store_phase_telemetry

HEALTH_FIX_MAX_ITERATIONS = 3


def _filter_llm_scope(health_report: HealthReport) -> HealthReport:
    return HealthReport(
        orphan_notes=[],
        stale_notes=list(health_report.stale_notes),
        missing_frontmatter=[],
        unresolved_contradictions=list(health_report.unresolved_contradictions),
        memory_overflow=health_report.memory_overflow,
        knowledge_gaps=list(health_report.knowledge_gaps),
        missing_backlinks=[],
        unclassified_lessons=list(health_report.unclassified_lessons),
        broken_wikilinks=[],
        total_issues=(
            len(health_report.unresolved_contradictions)
            + len(health_report.knowledge_gaps)
            + len(health_report.unclassified_lessons)
        ),
    )


def _format_llm_health_summary(scoped: HealthReport) -> list[str]:
    issues: list[str] = []
    for entry in scoped.unresolved_contradictions:
        issues.append(f"- Unresolved contradiction: {entry}")
    for entry in scoped.knowledge_gaps:
        issues.append(f"- Knowledge gap: {entry}")
    for entry in scoped.unclassified_lessons:
        issues.append(f"- Unclassified lesson: {entry}")
    return issues


def _deserialize_messages(messages_json: list[dict[str, Any]]) -> list[Any]:
    """Best-effort deserialization of pydantic_ai messages from JSON."""
    result: list[Any] = []
    for m in messages_json:
        try:
            # Pass the raw dict through — pydantic_ai agents accept dict-like history
            result.append(m)
        except Exception:  # noqa: BLE001
            pass
    return result


@activity.defn(name="deep.health_fix")
async def health_fix(inp: HealthFixInput) -> HealthFixResult:
    """Bounded 3-iteration health-fix loop. Returns status='incomplete' on exhaustion."""
    source_date = date.fromisoformat(inp.source_date_iso)
    workspace = Path(settings.jarvis_memory_path)

    consolidation_messages = _deserialize_messages(inp.consolidation_messages_json)

    deps = DeepDreamDeps(
        source_date=source_date,
        memu_memories=inp.memu_memories,
        memory_md=inp.memory_md,
        daily_log=inp.daily_log,
        soul_md=inp.soul_md,
        phase1_summary=inp.phase1_summary,
        phase2_summary=inp.phase2_summary,
    )

    gap_names: list[str] = []

    health_report: HealthReport | None = None
    iteration = 1

    while True:
        # Run auto-fix first (deterministic Python repairs)
        try:
            await auto_fix_health_issues(
                workspace,
                health_report if health_report is not None else HealthReport(),
                source_date,
            )
        except Exception as exc:
            activity.logger.warning("deep.health_fix.auto_fix.failed iter=%d: %s", iteration, exc)

        # Run health checks
        try:
            health_report = await run_health_checks(workspace, knowledge_gaps=gap_names)
        except Exception as exc:
            activity.logger.warning(
                "deep.health_fix.health_check.failed iter=%d: %s", iteration, exc
            )
            break

        if health_report.total_issues == 0:
            return HealthFixResult(
                status="clean",
                report_json=health_report.model_dump(),
                total_issues_remaining=0,
            )

        if not consolidation_messages:
            # No LLM history — can't make progress with agent; stop
            break

        if iteration > HEALTH_FIX_MAX_ITERATIONS:
            return HealthFixResult(
                status="incomplete",
                report_json=health_report.model_dump(),
                total_issues_remaining=health_report.total_issues,
            )

        scoped_report = _filter_llm_scope(health_report)
        scoped_issues = _format_llm_health_summary(scoped_report)
        if not scoped_issues:
            iteration += 1
            continue

        health_summary = "\n".join(scoped_issues)

        try:
            fix_output, fix_usage, fix_tool_calls, fix_messages = await run_health_fix(
                deps, consolidation_messages, health_summary
            )
            await store_phase_telemetry(
                dream_id=inp.dream_id,
                phase="health_fix",
                status="completed",
                run_prompt=health_summary,
                output_json=fix_output.model_dump(),
                messages=fix_messages,
                usage=fix_usage,
                tool_calls=fix_tool_calls,
                duration_ms=0,
                started_at=None,
            )
        except Exception as exc:
            activity.logger.warning("deep.health_fix.iteration_failed iter=%d: %s", iteration, exc)
            await store_phase_telemetry(
                dream_id=inp.dream_id,
                phase="health_fix",
                status="failed",
                run_prompt=health_summary,
                duration_ms=0,
                error_message=str(exc),
            )
            break

        iteration += 1

    final_report = health_report if health_report is not None else HealthReport()
    return HealthFixResult(
        status="incomplete",
        report_json=final_report.model_dump(),
        total_issues_remaining=final_report.total_issues,
    )
