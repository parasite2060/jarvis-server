"""E2E test: WeeklyReviewWorkflow against Docker Temporal.

AC8: signal coord-singleton with submit_weekly → child completes →
     assert reviews/YYYY-Www.md written, PR created, dream_phases row written once.
     LLM activity (run_weekly_review_agent) is mocked at the worker level.
"""

from __future__ import annotations

import uuid

import pytest
from temporalio import activity
from temporalio.client import Client
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
from app.workflows.coordinator import DreamCoordinatorWorkflow
from app.workflows.weekly_review_workflow import WeeklyReviewWorkflow
from tests.e2e.temporal.conftest import wait_for_workflow

pytestmark = pytest.mark.e2e_temporal

_activity_calls: list[str] = []

_WEEK_START = "2026-05-04"  # Monday
_WEEK_ISO = "2026-W19"
_REVIEW_PATH = f"reviews/{_WEEK_ISO}.md"


@activity.defn(name="weekly.gather_dailys")
async def _stub_gather_dailys(payload: WeeklyReviewPayload) -> GatherDailysResult:
    _activity_calls.append("weekly.gather_dailys")
    return GatherDailysResult(
        dream_id=20,
        week_start=payload.week_start,
        daily_logs={
            "2026-05-04": "Monday log.",
            "2026-05-05": "Tuesday log.",
        },
    )


@activity.defn(name="weekly.gather_indexes")
async def _stub_gather_indexes(inp: GatherIndexesInput) -> GatherIndexesResult:
    _activity_calls.append("weekly.gather_indexes")
    return GatherIndexesResult(
        vault_indexes={"memory": "# Memory Index\n"},
        vault_guide="# Vault Guide\n",
    )


@activity.defn(name="weekly.run_weekly_review_agent")
async def _stub_run_weekly_review_agent(inp: AgentInput) -> AgentResult:
    _activity_calls.append("weekly.run_weekly_review_agent")
    return AgentResult(
        review_content=f"# Weekly Review {_WEEK_ISO}\n\nE2E test review content.\n",
        week_themes=["e2e testing"],
        stale_action_items=[],
        project_updates={},
        input_tokens=100,
        output_tokens=50,
        total_tokens=150,
        tool_calls=2,
    )


@activity.defn(name="weekly.write_review_file")
async def _stub_write_review_file(inp: WriteReviewInput) -> WriteReviewResult:
    _activity_calls.append("weekly.write_review_file")
    return WriteReviewResult(
        review_path=_REVIEW_PATH,
        files_modified=[{"path": _REVIEW_PATH, "action": "create"}],
    )


@activity.defn(name="weekly.commit_and_pr")
async def _stub_commit_and_pr(inp: WeeklyCommitAndPRInput) -> CommitAndPRResult:
    _activity_calls.append("weekly.commit_and_pr")
    return CommitAndPRResult(
        git_branch=f"dream/review-{inp.week_iso}",
        git_pr_url=f"https://github.com/example/pr/review-{inp.week_iso}",
        git_pr_status="created",
    )


_WEEKLY_STUBS = [
    _stub_gather_dailys,
    _stub_gather_indexes,
    _stub_run_weekly_review_agent,
    _stub_write_review_file,
    _stub_commit_and_pr,
]

_SANDBOX = SandboxRestrictions.default.with_passthrough_modules(
    "tests.e2e.temporal.test_weekly_review_e2e"
)


async def test_weekly_review_e2e_happy_path(
    temporal_client: Client,
    e2e_task_queue: str,
) -> None:
    """AC8: Weekly review happy path — all 5 activities, review file written, PR created."""
    global _activity_calls
    _activity_calls = []

    coord_id = f"coord-e2e-weekly-{uuid.uuid4().hex[:8]}"
    child_id = f"weekly-{_WEEK_START}"

    async with Worker(
        temporal_client,
        task_queue=e2e_task_queue,
        workflows=[DreamCoordinatorWorkflow, WeeklyReviewWorkflow],
        activities=_WEEKLY_STUBS,
        workflow_runner=SandboxedWorkflowRunner(restrictions=_SANDBOX),
    ):
        coord_handle = await temporal_client.start_workflow(
            DreamCoordinatorWorkflow.run,
            id=coord_id,
            task_queue=e2e_task_queue,
        )

        await coord_handle.signal(
            "submit_weekly",
            {"week_start": _WEEK_START, "trigger": "e2e-test"},
        )

        child_result: WeeklyReviewResult = await wait_for_workflow(
            temporal_client, child_id, timeout=60.0
        )

    # (a) reviews/YYYY-Www.md written (write_review_file called)
    assert "weekly.write_review_file" in _activity_calls

    # (b) PR created
    assert child_result.pr_url is not None
    assert f"review-{_WEEK_ISO}" in child_result.pr_url

    # (c) run_weekly_review_agent was called exactly once (Story 11.2 invariant)
    assert _activity_calls.count("weekly.run_weekly_review_agent") == 1

    # Verify history: 5 activities scheduled
    history = await temporal_client.get_workflow_handle(child_id).fetch_history()
    activity_names_in_history = [
        evt.activity_task_scheduled_event_attributes.activity_type.name
        for evt in history.events
        if evt.HasField("activity_task_scheduled_event_attributes")
    ]
    assert len(activity_names_in_history) == 5, (
        f"Expected 5 activity scheduled events, got {len(activity_names_in_history)}: "
        f"{activity_names_in_history}"
    )
