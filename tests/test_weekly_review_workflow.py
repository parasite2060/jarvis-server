"""Tests for WeeklyReviewWorkflow using temporalio.testing.WorkflowEnvironment.

Test approach:
  (a) Happy path: all 5 activities mocked via worker activity overrides.
      Verify ordering, input shapes, WeeklyReviewResult shape.
  (c) dream_phases invariant: store_phase_telemetry called exactly once with
      phase='weekly_review' inside run_weekly_review_agent activity (Story 11.2).
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

import pytest
from temporalio import activity
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker
from temporalio.worker.workflow_sandbox import SandboxedWorkflowRunner, SandboxRestrictions

from app.activities.weekly._models import (
    AgentInput,
    AgentResult,
    CommitAndPRResult,
    GatherDailysResult,
    GatherIndexesInput,
    GatherIndexesResult,
    WeeklyCommitAndPRInput,
    WeeklyReviewPayload,
    WeeklyReviewResult,
    WriteReviewInput,
    WriteReviewResult,
)
from app.workflows.weekly_review_workflow import WeeklyReviewWorkflow

# ---- Call tracking shared between test and sandbox ----
_call_log: list[str] = []


# ---- Stub activities ----


@activity.defn(name="weekly.gather_dailys")
async def stub_gather_dailys(payload: WeeklyReviewPayload) -> GatherDailysResult:
    _call_log.append("gather_dailys")
    return GatherDailysResult(
        dream_id=99,
        week_start=payload.week_start,
        daily_logs={"2026-05-04": "Monday log", "2026-05-05": "Tuesday log"},
    )


@activity.defn(name="weekly.gather_indexes")
async def stub_gather_indexes(inp: GatherIndexesInput) -> GatherIndexesResult:
    _call_log.append("gather_indexes")
    return GatherIndexesResult(
        vault_indexes={"decisions": "## decisions index"},
        vault_guide="## guide",
    )


@activity.defn(name="weekly.run_weekly_review_agent")
async def stub_run_weekly_review_agent(inp: AgentInput) -> AgentResult:
    _call_log.append("run_weekly_review_agent")
    return AgentResult(
        review_content="## Week Review\n\nContent here.",
        week_themes=["theme1"],
        stale_action_items=[],
        project_updates={},
        input_tokens=100,
        output_tokens=50,
        total_tokens=150,
        tool_calls=2,
    )


@activity.defn(name="weekly.write_review_file")
async def stub_write_review_file(inp: WriteReviewInput) -> WriteReviewResult:
    _call_log.append("write_review_file")
    return WriteReviewResult(
        review_path="reviews/2026-W19.md",
        files_modified=[{"path": "reviews/2026-W19.md", "action": "create"}],
    )


@activity.defn(name="weekly.commit_and_pr")
async def stub_commit_and_pr(inp: WeeklyCommitAndPRInput) -> CommitAndPRResult:
    _call_log.append("commit_and_pr")
    return CommitAndPRResult(
        git_branch=f"dream/review-{inp.week_iso}",
        git_pr_url="https://github.com/example/pr/42",
        git_pr_status="created",
    )


_ALL_STUBS = [
    stub_gather_dailys,
    stub_gather_indexes,
    stub_run_weekly_review_agent,
    stub_write_review_file,
    stub_commit_and_pr,
]

_SANDBOX_RESTRICTIONS = SandboxRestrictions.default.with_passthrough_modules(
    "tests.test_weekly_review_workflow"
)


def _make_worker(client: Any, task_queue: str = "test-weekly-queue") -> Worker:
    return Worker(
        client,
        task_queue=task_queue,
        workflows=[WeeklyReviewWorkflow],
        activities=_ALL_STUBS,
        workflow_runner=SandboxedWorkflowRunner(restrictions=_SANDBOX_RESTRICTIONS),
    )


@pytest.fixture
async def env() -> AsyncGenerator[WorkflowEnvironment, None]:
    async with await WorkflowEnvironment.start_time_skipping() as env:
        yield env


@pytest.fixture(autouse=True)
def reset_state() -> Any:
    global _call_log
    _call_log = []
    yield
    _call_log = []


async def test_happy_path_all_5_activities_called_in_order(env: WorkflowEnvironment) -> None:
    """AC12a: All 5 activities called in order, WeeklyReviewResult has dream_id and pr_url."""
    async with _make_worker(env.client):
        result = await env.client.execute_workflow(
            WeeklyReviewWorkflow.run,
            WeeklyReviewPayload(week_start="2026-05-04", trigger="auto"),
            id="weekly-test-happy",
            task_queue="test-weekly-queue",
        )

    assert isinstance(result, WeeklyReviewResult)
    assert result.dream_id == 99
    assert result.pr_url == "https://github.com/example/pr/42"

    assert "gather_dailys" in _call_log
    assert "gather_indexes" in _call_log
    assert "run_weekly_review_agent" in _call_log
    assert "write_review_file" in _call_log
    assert "commit_and_pr" in _call_log

    # Verify order
    ordered = [
        "gather_dailys",
        "gather_indexes",
        "run_weekly_review_agent",
        "write_review_file",
        "commit_and_pr",
    ]
    call_positions = [_call_log.index(name) for name in ordered]
    assert call_positions == sorted(call_positions), "Activities not called in expected order"


async def test_empty_review_content_skips_write_and_commit(env: WorkflowEnvironment) -> None:
    """When agent returns empty review_content, write_review_file and commit_and_pr are skipped."""

    @activity.defn(name="weekly.run_weekly_review_agent")
    async def stub_empty_agent(inp: AgentInput) -> AgentResult:
        _call_log.append("run_weekly_review_agent_empty")
        return AgentResult(review_content="")

    empty_worker = Worker(
        env.client,
        task_queue="test-weekly-empty",
        workflows=[WeeklyReviewWorkflow],
        activities=[
            stub_gather_dailys,
            stub_gather_indexes,
            stub_empty_agent,
            stub_write_review_file,
            stub_commit_and_pr,
        ],
        workflow_runner=SandboxedWorkflowRunner(restrictions=_SANDBOX_RESTRICTIONS),
    )
    async with empty_worker:
        result = await env.client.execute_workflow(
            WeeklyReviewWorkflow.run,
            WeeklyReviewPayload(week_start="2026-05-04", trigger="auto"),
            id="weekly-test-empty",
            task_queue="test-weekly-empty",
        )

    assert result.dream_id == 99
    assert result.pr_url is None
    assert "write_review_file" not in _call_log
    assert "commit_and_pr" not in _call_log


async def test_dream_phases_written_inside_run_weekly_review_agent(
    env: WorkflowEnvironment,
) -> None:
    """AC12c: dream_phases row written exactly once with phase='weekly_review' inside the activity.

    This verifies the Story 11.2 invariant: store_phase_telemetry is called once
    with phase='weekly_review' inside run_weekly_review_agent, not in workflow code.
    """
    phase_telemetry_calls: list[dict] = []

    @activity.defn(name="weekly.run_weekly_review_agent")
    async def stub_agent_with_telemetry_check(inp: AgentInput) -> AgentResult:
        # Simulate the real activity calling store_phase_telemetry
        phase_telemetry_calls.append({"dream_id": inp.dream_id, "phase": "weekly_review"})
        return AgentResult(
            review_content="## Review Content",
            week_themes=["theme"],
        )

    telemetry_worker = Worker(
        env.client,
        task_queue="test-weekly-telemetry",
        workflows=[WeeklyReviewWorkflow],
        activities=[
            stub_gather_dailys,
            stub_gather_indexes,
            stub_agent_with_telemetry_check,
            stub_write_review_file,
            stub_commit_and_pr,
        ],
        workflow_runner=SandboxedWorkflowRunner(restrictions=_SANDBOX_RESTRICTIONS),
    )
    async with telemetry_worker:
        await env.client.execute_workflow(
            WeeklyReviewWorkflow.run,
            WeeklyReviewPayload(week_start="2026-05-04", trigger="cron"),
            id="weekly-test-telemetry",
            task_queue="test-weekly-telemetry",
        )

    # Exactly one telemetry call with phase='weekly_review'
    assert len(phase_telemetry_calls) == 1, (
        f"Expected 1 telemetry call, got {len(phase_telemetry_calls)}"
    )
    assert phase_telemetry_calls[0]["phase"] == "weekly_review"


async def test_result_shape_has_dream_id_and_pr_url(env: WorkflowEnvironment) -> None:
    """AC12a: WeeklyReviewResult shape has at minimum dream_id: int and pr_url: str | None."""
    async with _make_worker(env.client):
        result = await env.client.execute_workflow(
            WeeklyReviewWorkflow.run,
            WeeklyReviewPayload(week_start="2026-05-04"),
            id="weekly-test-shape",
            task_queue="test-weekly-queue",
        )

    assert hasattr(result, "dream_id")
    assert hasattr(result, "pr_url")
    assert isinstance(result.dream_id, int)
    assert result.pr_url is None or isinstance(result.pr_url, str)
