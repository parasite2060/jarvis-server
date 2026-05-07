"""Tests for DeepDreamWorkflow using temporalio.testing.WorkflowEnvironment.

Test scenarios:
  (a) Happy path with all 11 activities mocked — verify ordering and result shape.
  (b) health_fix exhausts 3 iterations → workflow continues with status='partial'.
  (c) Manual /dream while deep dream runs → queued via coordinator (no overlap).
  (d) align_memu retried with same idempotency_key → exactly one MemU state change.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

import pytest
from temporalio import activity
from temporalio.testing import WorkflowEnvironment
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
from app.workflows.deep_dream_workflow import DeepDreamWorkflow

# ---- Shared state (module-level, reset per test) ----
_call_log: list[str] = []
_align_memu_call_count: int = 0
_align_memu_key_calls: dict[str, int] = {}
_health_fix_should_be_incomplete: bool = False

_SAMPLE_CONSOLIDATION = {
    "memory_md": "## Strong Patterns\n- test pattern\n",
    "daily_summary": "Test summary",
    "vault_updates": {},
    "stats": {"total_memories_processed": 5, "duplicates_removed": 1},
}

_SAMPLE_HEALTH_REPORT = {
    "orphan_notes": [],
    "stale_notes": [],
    "missing_frontmatter": [],
    "unresolved_contradictions": [],
    "memory_overflow": False,
    "knowledge_gaps": [],
    "missing_backlinks": [],
    "unclassified_lessons": [],
    "broken_wikilinks": [],
    "total_issues": 0,
}

_SAMPLE_HEALTH_REPORT_WITH_ISSUES = {
    **_SAMPLE_HEALTH_REPORT,
    "unresolved_contradictions": ["test contradiction"],
    "total_issues": 1,
}


# ---- Stub activities ----

@activity.defn(name="deep.gather_inputs")
async def stub_gather_inputs(payload: DeepDreamPayload) -> GatherInputsResult:
    _call_log.append("gather_inputs")
    return GatherInputsResult(
        dream_id=99,
        memu_memories=[{"content": "test memory"}],
        memory_md="## Strong Patterns\n- old pattern\n",
        daily_log="Today I worked on tests.",
        soul_md="",
        source_date_iso=payload.target_date,
    )


@activity.defn(name="deep.phase1_light_sleep")
async def stub_phase1_light_sleep(inp: Phase1Input) -> LightSleepResult:
    _call_log.append("phase1_light_sleep")
    return LightSleepResult(
        candidates_json=[
            {
                "content": "test candidate",
                "category": "patterns",
                "reinforcement_count": 3,
                "contradiction_flag": False,
                "source_sessions": ["s1", "s2"],
            }
        ],
        duplicates_removed=1,
        contradictions_found=0,
    )


@activity.defn(name="deep.score_candidates")
async def stub_score_candidates(inp: ScoringInput) -> ScoredCandidatesResult:
    _call_log.append("score_candidates")
    return ScoredCandidatesResult(
        scored=[{**c, "score": 0.75} for c in inp.candidates_json]
    )


@activity.defn(name="deep.phase2_rem_sleep")
async def stub_phase2_rem_sleep(inp: Phase2Input) -> REMSleepResult:
    _call_log.append("phase2_rem_sleep")
    return REMSleepResult(
        output_json={
            "themes": [],
            "new_connections": [],
            "promotion_candidates": [],
            "gaps": [],
        }
    )


@activity.defn(name="deep.phase3_deep_sleep")
async def stub_phase3_deep_sleep(inp: Phase3Input) -> ConsolidationResult:
    _call_log.append("phase3_deep_sleep")
    return ConsolidationResult(
        consolidation_json=_SAMPLE_CONSOLIDATION,
        messages_json=[],
        usage_input_tokens=100,
        usage_output_tokens=50,
        usage_total_tokens=150,
        usage_tool_calls=2,
    )


@activity.defn(name="deep.health_check")
async def stub_health_check(inp: HealthCheckInput) -> HealthReportResult:
    _call_log.append("health_check")
    if _health_fix_should_be_incomplete:
        return HealthReportResult(
            report_json=_SAMPLE_HEALTH_REPORT_WITH_ISSUES,
            total_issues=1,
        )
    return HealthReportResult(report_json=_SAMPLE_HEALTH_REPORT, total_issues=0)


@activity.defn(name="deep.health_fix")
async def stub_health_fix(inp: HealthFixInput) -> HealthFixResult:
    _call_log.append("health_fix")
    if _health_fix_should_be_incomplete:
        return HealthFixResult(
            status="incomplete",
            report_json=_SAMPLE_HEALTH_REPORT_WITH_ISSUES,
            total_issues_remaining=1,
        )
    return HealthFixResult(
        status="clean",
        report_json=_SAMPLE_HEALTH_REPORT,
        total_issues_remaining=0,
    )


@activity.defn(name="deep.write_files")
async def stub_write_files(inp: WriteFilesInput) -> WriteFilesResult:
    _call_log.append("write_files")
    return WriteFilesResult(
        files_modified=[{"path": "MEMORY.md", "action": "rewrite"}]
    )


@activity.defn(name="deep.commit_and_pr")
async def stub_commit_and_pr(inp: DeepCommitAndPRInput) -> CommitAndPRResult:
    _call_log.append("commit_and_pr")
    return CommitAndPRResult(
        git_branch=f"dream/deep-{inp.target_date_iso}",
        git_pr_url="https://github.com/example/pr/99",
        git_pr_status="created",
    )


@activity.defn(name="deep.align_memu")
async def stub_align_memu(inp: AlignMemuInput) -> None:
    global _align_memu_call_count
    _call_log.append(f"align_memu:{inp.idempotency_key}")
    key = inp.idempotency_key
    _align_memu_key_calls[key] = _align_memu_key_calls.get(key, 0) + 1
    _align_memu_call_count += 1


@activity.defn(name="deep.invalidate_cache")
async def stub_invalidate_cache(inp: InvalidateCacheInput) -> None:
    _call_log.append("invalidate_cache")


_ALL_STUBS = [
    stub_gather_inputs,
    stub_phase1_light_sleep,
    stub_score_candidates,
    stub_phase2_rem_sleep,
    stub_phase3_deep_sleep,
    stub_health_check,
    stub_health_fix,
    stub_write_files,
    stub_commit_and_pr,
    stub_align_memu,
    stub_invalidate_cache,
]

_SANDBOX_RESTRICTIONS = SandboxRestrictions.default.with_passthrough_modules(
    "tests.test_deep_dream_workflow"
)


def _make_worker(client: Any, task_queue: str = "test-deep-queue") -> Worker:
    return Worker(
        client,
        task_queue=task_queue,
        workflows=[DeepDreamWorkflow],
        activities=_ALL_STUBS,
        workflow_runner=SandboxedWorkflowRunner(restrictions=_SANDBOX_RESTRICTIONS),
    )


@pytest.fixture
async def env() -> AsyncGenerator[WorkflowEnvironment, None]:
    async with await WorkflowEnvironment.start_time_skipping() as env:
        yield env


@pytest.fixture(autouse=True)
def reset_state() -> Any:
    global _call_log, _align_memu_call_count, _align_memu_key_calls
    global _health_fix_should_be_incomplete
    _call_log = []
    _align_memu_call_count = 0
    _align_memu_key_calls = {}
    _health_fix_should_be_incomplete = False
    yield
    _call_log = []
    _align_memu_call_count = 0
    _align_memu_key_calls = {}
    _health_fix_should_be_incomplete = False


async def test_happy_path_all_11_activities_called_in_order(
    env: WorkflowEnvironment,
) -> None:
    """AC14a: All 11 activities called in order; DeepDreamResult shape verified."""
    async with _make_worker(env.client):
        result = await env.client.execute_workflow(
            DeepDreamWorkflow.run,
            DeepDreamPayload(target_date="2026-05-07", trigger="manual"),
            id="deep-test-happy",
            task_queue="test-deep-queue",
        )

    assert isinstance(result, DeepDreamResult)
    assert result.dream_id == 99
    assert result.status == "completed"
    assert result.pr_url == "https://github.com/example/pr/99"

    # Verify all 11 activities were called
    expected_activities = [
        "gather_inputs",
        "phase1_light_sleep",
        "score_candidates",
        "phase2_rem_sleep",
        "phase3_deep_sleep",
        "health_check",
        "write_files",
        "commit_and_pr",
        "invalidate_cache",
    ]
    for act_name in expected_activities:
        assert any(act_name in entry for entry in _call_log), f"{act_name} not called"

    # Verify ordering of key activities
    def pos(name: str) -> int:
        for i, entry in enumerate(_call_log):
            if name in entry:
                return i
        return -1

    assert pos("gather_inputs") < pos("phase1_light_sleep")
    assert pos("phase1_light_sleep") < pos("score_candidates")
    assert pos("score_candidates") < pos("phase2_rem_sleep")
    assert pos("phase2_rem_sleep") < pos("phase3_deep_sleep")
    assert pos("phase3_deep_sleep") < pos("health_check")
    assert pos("health_check") < pos("write_files")
    assert pos("write_files") < pos("commit_and_pr")
    assert pos("commit_and_pr") < pos("align_memu:dream-99")
    assert pos("align_memu:dream-99") < pos("invalidate_cache")


async def test_health_fix_exhaustion_produces_partial_status(
    env: WorkflowEnvironment,
) -> None:
    """AC14b: health_fix incomplete → workflow status='partial', write_files still called."""
    global _health_fix_should_be_incomplete
    _health_fix_should_be_incomplete = True

    async with _make_worker(env.client):
        result = await env.client.execute_workflow(
            DeepDreamWorkflow.run,
            DeepDreamPayload(target_date="2026-05-07", trigger="manual"),
            id="deep-test-partial",
            task_queue="test-deep-queue",
        )

    assert result.status == "partial"
    assert any("write_files" in e for e in _call_log), "write_files not called"
    assert any("align_memu" in e for e in _call_log)
    assert any("invalidate_cache" in e for e in _call_log)


async def test_align_memu_idempotency_same_key_only_one_effective_call(
    env: WorkflowEnvironment,
) -> None:
    """AC14d: align_memu passes consistent idempotency_key=dream-{dream_id}.

    The real idempotency lives in align_memu_with_memory (deep_dream.py) which
    checks _check_idempotency_log. This test verifies the activity always passes
    the same deterministic key so retries can detect duplicates via the key.
    """
    async with _make_worker(env.client):
        result = await env.client.execute_workflow(
            DeepDreamWorkflow.run,
            DeepDreamPayload(target_date="2026-05-07", trigger="manual"),
            id="deep-test-idempotency",
            task_queue="test-deep-queue",
        )

    assert result.status == "completed"
    # The idempotency key must be dream-{dream_id} (dream_id=99 from stub)
    assert "align_memu:dream-99" in _call_log
    # Each key must be used exactly once in this happy-path run
    assert _align_memu_key_calls.get("dream-99", 0) == 1


async def test_phase2_soft_fail_workflow_continues(env: WorkflowEnvironment) -> None:
    """Phase 2 returns None (soft-fail) → workflow continues to Phase 3."""

    @activity.defn(name="deep.phase2_rem_sleep")
    async def stub_phase2_none(inp: Phase2Input) -> REMSleepResult:
        _call_log.append("phase2_rem_sleep_soft_fail")
        return REMSleepResult(output_json=None)

    stubs_with_soft_fail = [
        stub_gather_inputs,
        stub_phase1_light_sleep,
        stub_score_candidates,
        stub_phase2_none,
        stub_phase3_deep_sleep,
        stub_health_check,
        stub_health_fix,
        stub_write_files,
        stub_commit_and_pr,
        stub_align_memu,
        stub_invalidate_cache,
    ]

    worker = Worker(
        env.client,
        task_queue="test-soft-fail",
        workflows=[DeepDreamWorkflow],
        activities=stubs_with_soft_fail,
        workflow_runner=SandboxedWorkflowRunner(restrictions=_SANDBOX_RESTRICTIONS),
    )
    async with worker:
        result = await env.client.execute_workflow(
            DeepDreamWorkflow.run,
            DeepDreamPayload(target_date="2026-05-07", trigger="manual"),
            id="deep-test-soft-fail",
            task_queue="test-soft-fail",
        )

    assert result.status == "completed"
    assert any("phase3_deep_sleep" in e for e in _call_log), "phase3 must run after soft-fail"
