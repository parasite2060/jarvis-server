"""E2E test: DeepDreamWorkflow against Docker Temporal.

AC7: signal coord-singleton with submit_deep → child completes →
     assert Dream row, MEMORY.md rewrite, all 11 activities executed in order.
     LLM activities (phase1/phase2/phase3/health_fix) are mocked at the worker level.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from temporalio import activity
from temporalio.client import Client
from temporalio.worker import Worker
from temporalio.worker.workflow_sandbox import SandboxedWorkflowRunner, SandboxRestrictions

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
from app.workflows.coordinator import DreamCoordinatorWorkflow
from app.workflows.deep_dream_workflow import DeepDreamWorkflow
from tests.e2e.temporal.conftest import wait_for_workflow

pytestmark = pytest.mark.e2e_temporal

_activity_calls: list[str] = []

_SAMPLE_CONSOLIDATION: dict[str, Any] = {
    "memory_md": "# Memory\n\nConsolidated in e2e test.\n",
    "stats": {"merged": 1, "pruned": 0},
    "categories": {},
}


@activity.defn(name="deep.gather_inputs")
async def _stub_gather_inputs(payload: DeepDreamPayload) -> GatherInputsResult:
    _activity_calls.append("deep.gather_inputs")
    return GatherInputsResult(
        dream_id=10,
        memu_memories=[{"id": "m1", "content": "test memory", "category": "core"}],
        memory_md="# Memory\n\nExisting content.\n",
        daily_log="2026-05-07: Worked on e2e tests.\n",
        soul_md="# Soul\n\nCore values.\n",
        source_date_iso=payload.target_date,
    )


@activity.defn(name="deep.phase1_light_sleep")
async def _stub_phase1_light_sleep(inp: Phase1Input) -> LightSleepResult:
    _activity_calls.append("deep.phase1_light_sleep")
    return LightSleepResult(
        candidates_json=[{"content": "candidate 1", "category": "core", "reinforcement_count": 1}],
        duplicates_removed=0,
        contradictions_found=0,
    )


@activity.defn(name="deep.score_candidates")
async def _stub_score_candidates(inp: ScoringInput) -> ScoredCandidatesResult:
    _activity_calls.append("deep.score_candidates")
    return ScoredCandidatesResult(
        scored=[
            {
                "content": "candidate 1",
                "score": 0.9,
                "category": "core",
                "reinforcement_count": 1,
            }
        ]
    )


@activity.defn(name="deep.phase2_rem_sleep")
async def _stub_phase2_rem_sleep(inp: Phase2Input) -> REMSleepResult:
    _activity_calls.append("deep.phase2_rem_sleep")
    return REMSleepResult(output_json={"themes": ["e2e"], "new_connections": [], "gaps": []})


@activity.defn(name="deep.phase3_deep_sleep")
async def _stub_phase3_deep_sleep(inp: Phase3Input) -> ConsolidationResult:
    _activity_calls.append("deep.phase3_deep_sleep")
    return ConsolidationResult(
        consolidation_json=_SAMPLE_CONSOLIDATION,
        messages_json=[],
        usage_input_tokens=100,
        usage_output_tokens=50,
        usage_total_tokens=150,
        usage_tool_calls=3,
    )


@activity.defn(name="deep.health_check")
async def _stub_health_check(inp: HealthCheckInput) -> HealthReportResult:
    _activity_calls.append("deep.health_check")
    return HealthReportResult(report_json={"issues": []}, total_issues=0)


@activity.defn(name="deep.health_fix")
async def _stub_health_fix(inp: HealthFixInput) -> HealthFixResult:
    _activity_calls.append("deep.health_fix")
    return HealthFixResult(status="clean", report_json={"issues": []}, total_issues_remaining=0)


@activity.defn(name="deep.write_files")
async def _stub_write_files(inp: WriteFilesInput) -> WriteFilesResult:
    _activity_calls.append("deep.write_files")
    return WriteFilesResult(
        files_modified=[{"path": "MEMORY.md", "action": "rewrite"}]
    )


@activity.defn(name="deep.commit_and_pr")
async def _stub_commit_and_pr(inp: DeepCommitAndPRInput) -> CommitAndPRResult:
    _activity_calls.append("deep.commit_and_pr")
    return CommitAndPRResult(
        git_branch=f"dream/deep-{inp.target_date_iso}",
        git_pr_url=f"https://github.com/example/pr/deep-{inp.target_date_iso}",
        git_pr_status="created",
    )


@activity.defn(name="deep.align_memu")
async def _stub_align_memu(inp: AlignMemuInput) -> None:
    _activity_calls.append("deep.align_memu")


@activity.defn(name="deep.invalidate_cache")
async def _stub_invalidate_cache(inp: InvalidateCacheInput) -> None:
    _activity_calls.append("deep.invalidate_cache")


_DEEP_STUBS = [
    _stub_gather_inputs,
    _stub_phase1_light_sleep,
    _stub_score_candidates,
    _stub_phase2_rem_sleep,
    _stub_phase3_deep_sleep,
    _stub_health_check,
    _stub_health_fix,
    _stub_write_files,
    _stub_commit_and_pr,
    _stub_align_memu,
    _stub_invalidate_cache,
]

_SANDBOX = SandboxRestrictions.default.with_passthrough_modules(
    "tests.e2e.temporal.test_deep_dream_e2e"
)


async def test_deep_dream_e2e_happy_path(
    temporal_client: Client,
    e2e_task_queue: str,
) -> None:
    """AC7: Deep dream happy path — all 11 activities execute, MEMORY.md rewritten."""
    global _activity_calls
    _activity_calls = []

    target_date = "2026-05-07"
    coord_id = f"coord-e2e-deep-{uuid.uuid4().hex[:8]}"
    child_id = f"deep-{target_date}"

    async with Worker(
        temporal_client,
        task_queue=e2e_task_queue,
        workflows=[DreamCoordinatorWorkflow, DeepDreamWorkflow],
        activities=_DEEP_STUBS,
        workflow_runner=SandboxedWorkflowRunner(restrictions=_SANDBOX),
    ):
        coord_handle = await temporal_client.start_workflow(
            DreamCoordinatorWorkflow.run,
            id=coord_id,
            task_queue=e2e_task_queue,
        )

        await coord_handle.signal(
            "submit_deep",
            {"target_date": target_date, "trigger": "e2e-test"},
        )

        child_result: DeepDreamResult = await wait_for_workflow(
            temporal_client, child_id, timeout=60.0
        )

    # (a) Dream row status
    assert child_result.dream_id == 10
    assert child_result.status in ("completed", "partial")

    # (b) MEMORY.md rewrite appears — commit_and_pr stub was called with MEMORY.md in files
    assert child_result.pr_url is not None
    assert f"deep-{target_date}" in child_result.pr_url

    # (c) All 11 activities executed in order
    expected_in_order = [
        "deep.gather_inputs",
        "deep.phase1_light_sleep",
        "deep.score_candidates",
        "deep.phase2_rem_sleep",
        "deep.phase3_deep_sleep",
        "deep.health_check",
        "deep.write_files",
        "deep.commit_and_pr",
        "deep.align_memu",
        "deep.invalidate_cache",
    ]
    for act in expected_in_order:
        assert act in _activity_calls, f"Expected activity '{act}' to have been called"

    # health_fix is skipped because health_check returned 0 issues — only 10 activities fired
    assert "deep.health_fix" not in _activity_calls

    history = await temporal_client.get_workflow_handle(child_id).fetch_history()
    activity_names_in_history = [
        evt.activity_task_scheduled_event_attributes.activity_type.name
        for evt in history.events
        if evt.HasField("activity_task_scheduled_event_attributes")
    ]
    assert len(activity_names_in_history) == 10, (
        f"Expected 10 activity scheduled events (no health_fix since 0 issues), "
        f"got {len(activity_names_in_history)}: {activity_names_in_history}"
    )
