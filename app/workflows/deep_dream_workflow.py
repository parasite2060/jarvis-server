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
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy

from app.activities.deep._models import (
    AlignMemuInput,
    CommitAndPRResult,
    ConsolidationResult,
    DeepCommitAndPRInput,
    DeepDreamPayload,
    DeepDreamResult,
    GatherInputsResult,
    HealthCheckInput,
    HealthFixInput,
    HealthFixResult,
    HealthReportResult,
    InvalidateCacheInput,
    LightSleepResult,
    Phase1Input,
    Phase2Input,
    Phase3Input,
    REMSleepResult,
    ScoredCandidatesResult,
    ScoringInput,
    WriteFilesInput,
    WriteFilesResult,
)

with workflow.unsafe.imports_passed_through():
    from app.activities.deep.align_memu import align_memu
    from app.activities.deep.commit_and_pr import commit_and_pr
    from app.activities.deep.gather_inputs import gather_inputs
    from app.activities.deep.health_check import health_check
    from app.activities.deep.health_fix import health_fix
    from app.activities.deep.invalidate_cache import invalidate_cache
    from app.activities.deep.phase1_light_sleep import phase1_light_sleep
    from app.activities.deep.phase2_rem_sleep import phase2_rem_sleep
    from app.activities.deep.phase3_deep_sleep import phase3_deep_sleep
    from app.activities.deep.score_candidates import score_candidates
    from app.activities.deep.write_files import write_files


def _format_phase1_summary(candidates: list[dict[str, Any]], scores: list[dict[str, Any]]) -> str:
    score_map = {s.get("content", ""): s.get("score", 0.0) for s in scores}
    lines = ["## Phase 1: Light Sleep Results", ""]
    lines.append(f"Candidates: {len(candidates)}")
    lines.append("")
    for c in candidates:
        score = round(score_map.get(c.get("content", ""), 0.0), 3)
        flag = " [CONTRADICTION]" if c.get("contradiction_flag") else ""
        lines.append(
            f"- ({c.get('category', '')}) {c.get('content', '')}"
            f" [score={score}, reinforced={c.get('reinforcement_count', 0)}]{flag}"
        )
    return "\n".join(lines)


def _format_phase2_summary(output_json: dict[str, Any] | None) -> str:
    if not output_json:
        return ""
    lines = ["## Phase 2: REM Sleep Results", ""]
    themes = output_json.get("themes", [])
    lines.append(f"Themes: {len(themes)}")
    connections = output_json.get("new_connections", [])
    lines.append(f"Connections: {len(connections)}")
    gaps = output_json.get("gaps", [])
    lines.append(f"Gaps: {len(gaps)}")
    return "\n".join(lines)


@workflow.defn(name="DeepDream")
class DeepDreamWorkflow:
    @workflow.run
    async def run(self, payload: DeepDreamPayload) -> DeepDreamResult:
        # Activity 1: gather_inputs — create Dream row, collect all inputs
        gather_result: GatherInputsResult = await workflow.execute_activity(
            gather_inputs,
            payload,
            start_to_close_timeout=timedelta(minutes=2),
            retry_policy=RetryPolicy(
                initial_interval=timedelta(seconds=2),
                backoff_coefficient=2.0,
                maximum_interval=timedelta(seconds=30),
                maximum_attempts=3,
            ),
        )

        dream_id = gather_result.dream_id

        # If no content was found, return skipped result
        if not gather_result.memu_memories and not gather_result.daily_log.strip():
            return DeepDreamResult(
                dream_id=dream_id,
                status="skipped",
            )

        # Activity 2: phase1_light_sleep — PydanticAI extraction + dedup
        phase1_result: LightSleepResult = await workflow.execute_activity(
            phase1_light_sleep,
            Phase1Input(
                dream_id=dream_id,
                memu_memories=gather_result.memu_memories,
                memory_md=gather_result.memory_md,
                daily_log=gather_result.daily_log,
                soul_md=gather_result.soul_md,
                source_date_iso=gather_result.source_date_iso,
            ),
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=RetryPolicy(
                initial_interval=timedelta(seconds=5),
                backoff_coefficient=2.0,
                maximum_interval=timedelta(seconds=60),
                maximum_attempts=2,
            ),
        )

        if not phase1_result.candidates_json:
            return DeepDreamResult(
                dream_id=dream_id,
                status="skipped",
            )

        # Activity 3: score_candidates — deterministic Python scoring
        scored_result: ScoredCandidatesResult = await workflow.execute_activity(
            score_candidates,
            ScoringInput(
                dream_id=dream_id,
                candidates_json=phase1_result.candidates_json,
            ),
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=RetryPolicy(
                initial_interval=timedelta(seconds=1),
                backoff_coefficient=2.0,
                maximum_interval=timedelta(seconds=10),
                maximum_attempts=3,
            ),
        )

        # Activity 4: phase2_rem_sleep — soft-fail, returns None on error
        phase2_result: REMSleepResult = await workflow.execute_activity(
            phase2_rem_sleep,
            Phase2Input(
                dream_id=dream_id,
                source_date_iso=gather_result.source_date_iso,
                candidates_json=phase1_result.candidates_json,
                scored_json=scored_result.scored,
            ),
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=RetryPolicy(
                initial_interval=timedelta(seconds=5),
                backoff_coefficient=2.0,
                maximum_interval=timedelta(seconds=60),
                maximum_attempts=2,
            ),
        )

        # Build summaries for phase3 (pure string formatting — deterministic)
        phase1_summary = _format_phase1_summary(
            phase1_result.candidates_json, scored_result.scored
        )
        phase2_summary = _format_phase2_summary(phase2_result.output_json)

        # Activity 5: phase3_deep_sleep — PydanticAI consolidation agent
        consolidation: ConsolidationResult = await workflow.execute_activity(
            phase3_deep_sleep,
            Phase3Input(
                dream_id=dream_id,
                source_date_iso=gather_result.source_date_iso,
                memu_memories=gather_result.memu_memories,
                memory_md=gather_result.memory_md,
                daily_log=gather_result.daily_log,
                soul_md=gather_result.soul_md,
                phase1_summary=phase1_summary,
                phase2_summary=phase2_summary,
            ),
            start_to_close_timeout=timedelta(minutes=15),
            retry_policy=RetryPolicy(
                initial_interval=timedelta(seconds=10),
                backoff_coefficient=2.0,
                maximum_interval=timedelta(seconds=120),
                maximum_attempts=2,
            ),
        )

        # Derive knowledge gap names from phase2 output (pure data extraction — deterministic)
        knowledge_gap_names: list[str] = []
        if phase2_result.output_json:
            for gap in phase2_result.output_json.get("gaps", []):
                concept = gap.get("concept", "")
                if concept:
                    knowledge_gap_names.append(concept)

        # Activity 6: health_check — deterministic Python checks
        health_report: HealthReportResult = await workflow.execute_activity(
            health_check,
            HealthCheckInput(
                dream_id=dream_id,
                source_date_iso=gather_result.source_date_iso,
                knowledge_gap_names=knowledge_gap_names,
            ),
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=RetryPolicy(
                initial_interval=timedelta(seconds=1),
                backoff_coefficient=2.0,
                maximum_interval=timedelta(seconds=10),
                maximum_attempts=3,
            ),
        )

        # Activity 7: health_fix — bounded loop (max 3 iterations) INSIDE activity
        is_partial = False
        if health_report.total_issues > 0:
            fix_result: HealthFixResult = await workflow.execute_activity(
                health_fix,
                HealthFixInput(
                    dream_id=dream_id,
                    source_date_iso=gather_result.source_date_iso,
                    memu_memories=gather_result.memu_memories,
                    memory_md=gather_result.memory_md,
                    daily_log=gather_result.daily_log,
                    soul_md=gather_result.soul_md,
                    phase1_summary=phase1_summary,
                    phase2_summary=phase2_summary,
                    consolidation_messages_json=consolidation.messages_json,
                ),
                start_to_close_timeout=timedelta(minutes=10),
                retry_policy=RetryPolicy(
                    initial_interval=timedelta(seconds=5),
                    backoff_coefficient=2.0,
                    maximum_interval=timedelta(seconds=60),
                    maximum_attempts=1,
                ),
            )
            if fix_result.status == "incomplete":
                is_partial = True

        # Activity 8: write_files — atomic file writes (DESTRUCTIVE)
        write_result: WriteFilesResult = await workflow.execute_activity(
            write_files,
            WriteFilesInput(
                dream_id=dream_id,
                source_date_iso=gather_result.source_date_iso,
                consolidation_json=consolidation.consolidation_json,
            ),
            start_to_close_timeout=timedelta(minutes=2),
            retry_policy=RetryPolicy(
                initial_interval=timedelta(seconds=2),
                backoff_coefficient=2.0,
                maximum_interval=timedelta(seconds=30),
                maximum_attempts=3,
            ),
        )

        # Activity 9: commit_and_pr — deterministic dream/deep-{date} branch
        pr_url: str | None = None
        if write_result.files_modified:
            stats = consolidation.consolidation_json.get("stats", {})
            commit_result: CommitAndPRResult = await workflow.execute_activity(
                commit_and_pr,
                DeepCommitAndPRInput(
                    dream_id=dream_id,
                    target_date_iso=payload.target_date,
                    files_modified=write_result.files_modified,
                    stats=stats,
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

        # Activity 10: align_memu — sync MemU with new MEMORY.md state
        # idempotency_key prevents duplicate MemU writes on worker crash/retry
        idempotency_key = f"dream-{dream_id}"
        validated_memory = consolidation.consolidation_json.get("memory_md", "")
        await workflow.execute_activity(
            align_memu,
            AlignMemuInput(
                dream_id=dream_id,
                memory_md=validated_memory,
                source_date_iso=gather_result.source_date_iso,
                idempotency_key=idempotency_key,
            ),
            start_to_close_timeout=timedelta(minutes=5),
            retry_policy=RetryPolicy(
                initial_interval=timedelta(seconds=5),
                backoff_coefficient=2.0,
                maximum_interval=timedelta(seconds=60),
                maximum_attempts=3,
            ),
        )

        # Activity 11: invalidate_cache — invalidate context cache
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

        return DeepDreamResult(
            dream_id=dream_id,
            status="partial" if is_partial else "completed",
            pr_url=pr_url,
        )
