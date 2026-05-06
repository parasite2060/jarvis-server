# DETERMINISM RULES — Temporal replays this workflow code on recovery.
# Any non-deterministic call breaks replay. Forbidden in this module:
#   - datetime.now(), datetime.utcnow(), time.time()
#   - random.*, secrets.*
#   - uuid.uuid4(), uuid.uuid1()
#   - file I/O, network I/O, DB queries
#   - asyncio.create_task() (use workflow.start_activity / workflow.execute_child_workflow)
#   - sys.argv, environment variable reads
# Allowed deterministic primitives:
#   - workflow.now(), workflow.uuid4(), workflow.random()
#   - workflow.wait_condition(), workflow.execute_child_workflow()
#   - workflow.signal handlers, workflow.query handlers
#   - pure-Python data manipulation (collections.deque, dicts, etc.)

from __future__ import annotations

from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

from app.activities.light._models import (
    CommitAndPRInput,
    ExtractionAgentOutput,
    ExtractionInput,
    InvalidateCacheInput,
    LightDreamPayload,
    LightDreamResult,
    LoadTranscriptResult,
    PersistSessionLogInput,
    RecordAgentOutput,
    RecordInput,
    UpdatePositionInput,
)

with workflow.unsafe.imports_passed_through():
    from app.activities.light.commit_and_pr import commit_and_pr
    from app.activities.light.invalidate_cache import invalidate_cache
    from app.activities.light.load_transcript import load_transcript
    from app.activities.light.persist_session_log import persist_session_log
    from app.activities.light.run_extraction import run_extraction
    from app.activities.light.run_record import run_record
    from app.activities.light.update_transcript_position import update_transcript_position


@workflow.defn(name="LightDream")
class LightDreamWorkflow:
    @workflow.run
    async def run(self, payload: LightDreamPayload) -> LightDreamResult:
        # Activity 1: load_transcript — fetch transcript row + create Dream row (status=processing)
        load_result: LoadTranscriptResult = await workflow.execute_activity(
            load_transcript,
            payload,
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=RetryPolicy(
                initial_interval=timedelta(seconds=1),
                backoff_coefficient=2.0,
                maximum_interval=timedelta(seconds=30),
                maximum_attempts=3,
            ),
        )

        dream_id = load_result.dream_id

        # Activity 2: run_extraction_agent — invoke PydanticAI extraction agent
        extraction_input = ExtractionInput(
            dream_id=dream_id,
            transcript_id=load_result.transcript_id,
            session_id=load_result.session_id,
            parsed_text=load_result.parsed_text,
            project=load_result.project,
            token_count=load_result.token_count,
            transcript_file=f"transcripts/{load_result.session_id}_workflow.txt",
        )
        extraction_output: ExtractionAgentOutput = await workflow.execute_activity(
            run_extraction,
            extraction_input,
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=RetryPolicy(
                initial_interval=timedelta(seconds=5),
                backoff_coefficient=2.0,
                maximum_interval=timedelta(seconds=60),
                maximum_attempts=2,
            ),
        )

        pr_url: str | None = None

        # Only persist + record + commit if extraction produced content
        if not extraction_output.no_extract:
            # Activity 3: persist_session_log — write session_log JSONB to dreams row
            await workflow.execute_activity(
                persist_session_log,
                PersistSessionLogInput(
                    dream_id=dream_id,
                    session_log_json=extraction_output.session_log_json,
                ),
                start_to_close_timeout=timedelta(seconds=15),
                retry_policy=RetryPolicy(
                    initial_interval=timedelta(seconds=1),
                    backoff_coefficient=2.0,
                    maximum_interval=timedelta(seconds=10),
                    maximum_attempts=5,
                ),
            )

            # Derive source_date from session_log memories; default to workflow start date.
            # workflow.now() is deterministic — replays return the same recorded timestamp.
            today_iso = workflow.now().date().isoformat()
            source_date_iso = _derive_source_date(extraction_output.session_log_json, today_iso)

            # Derive session start time from load result (pure string parsing — deterministic)
            session_start_iso = _derive_session_start(load_result.created_at_iso)

            # Activity 4: run_record_agent — invoke PydanticAI record agent
            record_input = RecordInput(
                dream_id=dream_id,
                transcript_id=load_result.transcript_id,
                session_id=load_result.session_id,
                summary=extraction_output.summary,
                session_log_json=extraction_output.session_log_json,
                is_continuation=load_result.is_continuation,
                source_date_iso=source_date_iso,
                session_start_iso=session_start_iso,
            )
            record_output: RecordAgentOutput = await workflow.execute_activity(
                run_record,
                record_input,
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=RetryPolicy(
                    initial_interval=timedelta(seconds=5),
                    backoff_coefficient=2.0,
                    maximum_interval=timedelta(seconds=60),
                    maximum_attempts=2,
                ),
            )

            # Activity 5: update_transcript_position — update Transcript.last_processed_line
            await workflow.execute_activity(
                update_transcript_position,
                UpdatePositionInput(
                    transcript_id=load_result.transcript_id,
                    segment_end_line=load_result.segment_end_line,
                ),
                start_to_close_timeout=timedelta(seconds=15),
                retry_policy=RetryPolicy(
                    initial_interval=timedelta(seconds=1),
                    backoff_coefficient=2.0,
                    maximum_interval=timedelta(seconds=10),
                    maximum_attempts=5,
                ),
            )

            if record_output.files_modified:
                # Activity 6: commit_and_pr — create dream/light-{session_id} branch + PR
                commit_result = await workflow.execute_activity(
                    commit_and_pr,
                    CommitAndPRInput(
                        session_id=payload.session_id,
                        dream_id=dream_id,
                        files_modified=record_output.files_modified,
                        source_date_iso=record_output.source_date_iso,
                        extraction_summary=extraction_output.summary,
                    ),
                    start_to_close_timeout=timedelta(minutes=2),
                    retry_policy=RetryPolicy(
                        initial_interval=timedelta(seconds=2),
                        backoff_coefficient=2.0,
                        maximum_interval=timedelta(seconds=30),
                        maximum_attempts=3,
                    ),
                )
                pr_url = commit_result.git_pr_url or None

                # Activity 7: invalidate_cache — invalidate in-memory context cache
                await workflow.execute_activity(
                    invalidate_cache,
                    InvalidateCacheInput(dream_id=dream_id),
                    start_to_close_timeout=timedelta(seconds=10),
                    retry_policy=RetryPolicy(
                        initial_interval=timedelta(seconds=1),
                        backoff_coefficient=2.0,
                        maximum_interval=timedelta(seconds=5),
                        maximum_attempts=5,
                    ),
                )

        return LightDreamResult(dream_id=dream_id, pr_url=pr_url)


def _derive_source_date(session_log_json: dict, workflow_date: str) -> str:
    """Return the most recent memory source_date from session_log, falling back to workflow_date."""
    memories = session_log_json.get("memories", [])
    best: str | None = None
    for item in memories:
        sd = item.get("source_date")
        if sd and isinstance(sd, str):
            if best is None or sd > best:
                best = sd
    return best if best else workflow_date


def _derive_session_start(created_at_iso: str | None) -> str | None:
    """Return HH:MM from ISO timestamp, or None. Uses only string parsing — deterministic."""
    if not created_at_iso:
        return None
    try:
        # ISO format: 2026-05-06T14:30:00+00:00 — extract HH:MM from position 11-16
        time_part = created_at_iso[11:16]
        if len(time_part) == 5 and time_part[2] == ":":
            return time_part
        return None
    except (IndexError, TypeError):
        return None
