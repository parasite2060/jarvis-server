from __future__ import annotations

from datetime import date
from pathlib import Path

from temporalio import activity

from app.activities.light._models import FileModified, RecordAgentOutput, RecordInput


@activity.defn(name="light.run_record")
async def run_record(inp: RecordInput) -> RecordAgentOutput:
    import time
    from datetime import UTC, datetime

    from app.config import settings as app_settings
    from app.services.dream_agent import RecordDeps
    from app.services.dream_agent import run_record as _run_record
    from app.services.dream_models import SessionLogEntry
    from app.services.dream_telemetry import store_phase_telemetry
    from app.services.memory_files import append_vault_log

    session_log = SessionLogEntry.model_validate(inp.session_log_json)
    source_date = date.fromisoformat(inp.source_date_iso)

    record_deps = RecordDeps(
        workspace=Path(app_settings.jarvis_memory_path),
        source_date=source_date,
        session_id=inp.session_id,
        summary=inp.summary,
        session_log=session_log,
        is_continuation=inp.is_continuation,
        session_start_iso=inp.session_start_iso,
    )

    run_prompt = (
        f"Record session to daily log. Session: {inp.session_id}, "
        f"Date: {inp.source_date_iso}, "
        f"Memories: {len(session_log.memories)}"
    )
    record_start = time.monotonic_ns() // 1_000_000
    record_started_at = datetime.now(UTC)

    record_result, record_usage, record_tool_calls, record_messages = await _run_record(
        record_deps, allowed_write_patterns=["dailys/*.md"]
    )
    duration_ms = time.monotonic_ns() // 1_000_000 - record_start

    files_modified = [FileModified(path=f.path, action=f.action) for f in record_result.files]
    await store_phase_telemetry(
        dream_id=inp.dream_id,
        phase="record",
        status="completed",
        run_prompt=run_prompt,
        output_json={
            "files": [f.model_dump() for f in record_result.files],
            "summary": record_result.summary,
        },
        messages=record_messages,
        usage=record_usage,
        tool_calls=record_tool_calls,
        duration_ms=duration_ms,
        started_at=record_started_at,
    )

    try:
        summary_title = inp.summary[:60] if inp.summary else "session"
        await append_vault_log(
            "ingest",
            f'Session "{summary_title}" -> dailys/{inp.source_date_iso}.md',
        )
        summary_lower = (record_result.summary or "").lower()
        for f in record_result.files:
            if f.action == "update" and "reinforc" in summary_lower:
                await append_vault_log("reinforce", f.path)
    except Exception:
        pass

    return RecordAgentOutput(
        files_modified=files_modified,
        summary=record_result.summary,
        source_date_iso=inp.source_date_iso,
    )
