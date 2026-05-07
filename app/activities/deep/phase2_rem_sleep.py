from __future__ import annotations

from datetime import date, timedelta

from temporalio import activity

from app.activities.deep._models import Phase2Input, REMSleepResult
from app.services.dream_agent import Phase2Deps, run_phase2_rem_sleep
from app.services.dream_telemetry import store_phase_telemetry
from app.services.memory_files import read_vault_file

_VAULT_INDEX_FOLDERS = (
    "decisions",
    "patterns",
    "concepts",
    "connections",
    "lessons",
    "projects",
)


@activity.defn(name="deep.phase2_rem_sleep")
async def phase2_rem_sleep(inp: Phase2Input) -> REMSleepResult:
    source_date = date.fromisoformat(inp.source_date_iso)

    try:
        daily_logs: dict[str, str] = {}
        for i in range(7):
            d = source_date - timedelta(days=i)
            content = await read_vault_file(f"dailys/{d.isoformat()}.md")
            if content:
                daily_logs[d.isoformat()] = content

        vault_indexes: dict[str, str] = {}
        for folder in _VAULT_INDEX_FOLDERS:
            content = await read_vault_file(f"{folder}/_index.md")
            if content:
                vault_indexes[folder] = content

        from app.services.dream_models import ScoredCandidate
        from app.tasks.deep_dream_task import _format_phase1_for_phase2, _format_vault_indexes

        candidates = [
            ScoredCandidate(**c) if not isinstance(c, ScoredCandidate) else c
            for c in inp.candidates_json
        ]
        scores = {c.get("content", ""): c.get("score", 0.0) for c in inp.scored_json}
        phase1_text = _format_phase1_for_phase2(candidates, scores)
        vault_index_text = _format_vault_indexes(vault_indexes)

        deps = Phase2Deps(
            source_date=source_date,
            daily_logs=daily_logs,
            vault_indexes=vault_indexes,
            phase1_candidates=candidates,
            phase1_text=phase1_text,
            vault_index_text=vault_index_text,
        )

        phase2_output, usage, tool_calls, messages = await run_phase2_rem_sleep(deps)

        await store_phase_telemetry(
            dream_id=inp.dream_id,
            phase="phase2_rem_sleep",
            status="completed",
            run_prompt=phase1_text[:500],
            output_json=phase2_output.model_dump(),
            messages=messages,
            usage=usage,
            tool_calls=tool_calls,
            duration_ms=0,
            started_at=None,
        )

        return REMSleepResult(output_json=phase2_output.model_dump())

    except Exception as exc:
        activity.logger.warning("deep.phase2_rem_sleep soft-failed: %s", exc)
        await store_phase_telemetry(
            dream_id=inp.dream_id,
            phase="phase2_rem_sleep",
            status="failed",
            run_prompt="",
            duration_ms=0,
            error_message=str(exc),
        )
        return REMSleepResult(output_json=None)
