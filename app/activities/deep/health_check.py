from __future__ import annotations

from pathlib import Path

from temporalio import activity

from app.activities.deep._models import HealthCheckInput, HealthReportResult
from app.config import settings
from app.services.deep_dream import run_health_checks


@activity.defn(name="deep.health_check")
async def health_check(inp: HealthCheckInput) -> HealthReportResult:
    workspace = Path(settings.jarvis_memory_path)

    report = await run_health_checks(
        workspace,
        knowledge_gaps=inp.knowledge_gap_names,
    )

    return HealthReportResult(
        report_json=report.model_dump(),
        total_issues=report.total_issues,
    )
