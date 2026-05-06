from __future__ import annotations

import shutil
import tempfile
import uuid
from pathlib import Path

from temporalio import activity

from app.activities.light._models import ExtractionAgentOutput, ExtractionInput


@activity.defn(name="light.run_extraction")
async def run_extraction(inp: ExtractionInput) -> ExtractionAgentOutput:
    from app.config import settings as app_settings
    from app.services.dream_agent import DreamDeps, run_dream_extraction
    from app.services.dream_telemetry import store_phase_telemetry

    vault_root = Path(app_settings.jarvis_memory_path)
    transcripts_dir = vault_root / "transcripts"
    transcripts_dir.mkdir(parents=True, exist_ok=True)

    transcript_filename = f"{inp.session_id}_{uuid.uuid4().hex[:8]}.txt"
    transcript_path = transcripts_dir / transcript_filename

    workspace = Path(tempfile.mkdtemp(prefix=f"dream-{inp.dream_id}-", dir="/tmp/jarvis-dreams"))
    try:
        (workspace / "transcript.txt").write_text(inp.parsed_text, encoding="utf-8")
        transcript_path.write_text(inp.parsed_text, encoding="utf-8")

        deps = DreamDeps(
            transcript_id=inp.transcript_id,
            workspace=workspace,
            memories=[],
            session_id=inp.session_id,
            project=inp.project,
            token_count=inp.token_count,
            transcript_file=f"transcripts/{transcript_filename}",
        )

        run_prompt = (
            f"Extract session insights from transcript.\n"
            f"Session ID: {deps.session_id}, Project: {deps.project or 'unknown'}, "
            f"Token count: {deps.token_count or 'unknown'}"
        )

        import time
        from datetime import UTC, datetime

        from pydantic_ai.exceptions import UsageLimitExceeded

        from app.core.exceptions import DreamError

        extraction_start = time.monotonic_ns() // 1_000_000
        extraction_started_at = datetime.now(UTC)
        try:
            summary, usage, tool_calls, extraction_messages = await run_dream_extraction(deps)
            duration_ms = time.monotonic_ns() // 1_000_000 - extraction_start
            await store_phase_telemetry(
                dream_id=inp.dream_id,
                phase="extraction",
                status="completed",
                run_prompt=run_prompt,
                output_json=summary.model_dump() if summary else None,
                messages=extraction_messages,
                usage=usage,
                tool_calls=tool_calls,
                duration_ms=duration_ms,
                started_at=extraction_started_at,
            )
            return ExtractionAgentOutput(
                summary=summary.summary,
                no_extract=summary.no_extract,
                session_log_json=summary.session_log.model_dump(),
                input_tokens=getattr(usage, "request_tokens", None),
                output_tokens=getattr(usage, "response_tokens", None),
                total_tokens=getattr(usage, "total_tokens", None),
                tool_calls=tool_calls,
            )
        except UsageLimitExceeded as exc:
            duration_ms = time.monotonic_ns() // 1_000_000 - extraction_start
            await store_phase_telemetry(
                dream_id=inp.dream_id,
                phase="extraction",
                status="failed",
                run_prompt=run_prompt,
                duration_ms=duration_ms,
                error_message=str(exc),
            )
            raise
        except (DreamError, Exception) as exc:
            duration_ms = time.monotonic_ns() // 1_000_000 - extraction_start
            await store_phase_telemetry(
                dream_id=inp.dream_id,
                phase="extraction",
                status="failed",
                run_prompt=run_prompt,
                duration_ms=duration_ms,
                error_message=str(exc),
            )
            raise
    finally:
        if transcript_path.exists():
            transcript_path.unlink()
        shutil.rmtree(workspace, ignore_errors=True)
