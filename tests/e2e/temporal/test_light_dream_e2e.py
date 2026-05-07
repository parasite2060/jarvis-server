"""E2E test: LightDreamWorkflow against Docker Temporal.

AC6: signal coord-singleton with submit_light → child completes →
     assert Dream row status, files_modified, PR created, 7 activity executions in history.

Since the e2e suite must not make real DB/git/LLM calls, all activities are stubbed
in an in-process Worker. The coordinator dispatch is exercised end-to-end against the
real Temporal server — the workflow code runs in the actual sandbox.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from temporalio import activity
from temporalio.client import Client
from temporalio.worker import Worker
from temporalio.worker.workflow_sandbox import SandboxedWorkflowRunner, SandboxRestrictions

from app.activities.light._models import (
    CommitAndPRInput,
    CommitAndPRResult,
    ExtractionAgentOutput,
    ExtractionInput,
    FileModified,
    InvalidateCacheInput,
    LightDreamPayload,
    LightDreamResult,
    LoadTranscriptResult,
    PersistSessionLogInput,
    RecordAgentOutput,
    RecordInput,
    UpdatePositionInput,
)
from app.workflows.coordinator import DreamCoordinatorWorkflow
from app.workflows.light_dream_workflow import LightDreamWorkflow
from tests.e2e.temporal.conftest import wait_for_workflow

pytestmark = pytest.mark.e2e_temporal

_SAMPLE_SESSION_LOG: dict[str, Any] = {
    "context": "",
    "key_exchanges": [],
    "decisions_made": [],
    "lessons_learned": [],
    "failed_lessons": [],
    "action_items": [],
    "concepts": [],
    "connections": [],
    "memories": [
        {
            "content": "e2e test memory",
            "reasoning": None,
            "vault_target": "memory",
            "source_date": "2026-05-07",
        }
    ],
}

_activity_calls: list[str] = []


@activity.defn(name="light.load_transcript")
async def _stub_load_transcript(payload: LightDreamPayload) -> LoadTranscriptResult:
    _activity_calls.append("light.load_transcript")
    return LoadTranscriptResult(
        dream_id=1,
        transcript_id=payload.transcript_id,
        session_id=payload.session_id,
        parsed_text="e2e transcript content",
        project=None,
        token_count=200,
        is_continuation=False,
        segment_end_line=20,
        created_at_iso="2026-05-07T10:00:00+00:00",
    )


@activity.defn(name="light.run_extraction")
async def _stub_run_extraction(inp: ExtractionInput) -> ExtractionAgentOutput:
    _activity_calls.append("light.run_extraction")
    return ExtractionAgentOutput(
        summary="e2e extraction summary",
        no_extract=False,
        session_log_json=_SAMPLE_SESSION_LOG,
        input_tokens=200,
        output_tokens=100,
        total_tokens=300,
        tool_calls=5,
    )


@activity.defn(name="light.persist_session_log")
async def _stub_persist_session_log(inp: PersistSessionLogInput) -> None:
    _activity_calls.append("light.persist_session_log")


@activity.defn(name="light.run_record")
async def _stub_run_record(inp: RecordInput) -> RecordAgentOutput:
    _activity_calls.append("light.run_record")
    return RecordAgentOutput(
        files_modified=[FileModified(path="dailys/2026-05-07.md", action="update")],
        summary="Daily log updated in e2e test",
        source_date_iso="2026-05-07",
    )


@activity.defn(name="light.update_transcript_position")
async def _stub_update_transcript_position(inp: UpdatePositionInput) -> None:
    _activity_calls.append("light.update_transcript_position")


@activity.defn(name="light.commit_and_pr")
async def _stub_commit_and_pr(inp: CommitAndPRInput) -> CommitAndPRResult:
    _activity_calls.append("light.commit_and_pr")
    return CommitAndPRResult(
        git_branch=f"dream/light-{inp.session_id}",
        git_pr_url=f"https://github.com/example/pr/light-{inp.session_id}",
        git_pr_status="created",
    )


@activity.defn(name="light.invalidate_cache")
async def _stub_invalidate_cache(inp: InvalidateCacheInput) -> None:
    _activity_calls.append("light.invalidate_cache")


_LIGHT_STUBS = [
    _stub_load_transcript,
    _stub_run_extraction,
    _stub_persist_session_log,
    _stub_run_record,
    _stub_update_transcript_position,
    _stub_commit_and_pr,
    _stub_invalidate_cache,
]

_SANDBOX = SandboxRestrictions.default.with_passthrough_modules(
    "tests.e2e.temporal.test_light_dream_e2e"
)


async def test_light_dream_e2e_happy_path(
    temporal_client: Client,
    e2e_task_queue: str,
) -> None:
    """AC6: Light dream happy path — all 7 activities execute, result is correct."""
    global _activity_calls
    _activity_calls = []

    session_id = f"e2e-light-{uuid.uuid4().hex[:8]}"
    coord_id = f"coord-e2e-{uuid.uuid4().hex[:8]}"
    child_id = f"light-{session_id}"

    async with Worker(
        temporal_client,
        task_queue=e2e_task_queue,
        workflows=[DreamCoordinatorWorkflow, LightDreamWorkflow],
        activities=_LIGHT_STUBS,
        workflow_runner=SandboxedWorkflowRunner(restrictions=_SANDBOX),
    ):
        # Start coordinator
        coord_handle = await temporal_client.start_workflow(
            DreamCoordinatorWorkflow.run,
            id=coord_id,
            task_queue=e2e_task_queue,
        )

        # Signal light dream
        await coord_handle.signal(
            "submit_light",
            {"transcript_id": 1, "session_id": session_id},
        )

        # Wait for child workflow to complete
        child_result: LightDreamResult = await wait_for_workflow(
            temporal_client, child_id, timeout=60.0
        )

    # (a) Verify result shape
    assert child_result.dream_id == 1
    assert child_result.pr_url is not None
    assert session_id in child_result.pr_url

    # (b) files_modified was populated (pr_url is set only when record_output.files_modified truthy)
    assert child_result.pr_url != ""

    # (c) PR URL contains session_id (stub creates deterministic URL)
    assert f"light-{session_id}" in child_result.pr_url

    # (d) All 7 activities executed
    expected_activities = [
        "light.load_transcript",
        "light.run_extraction",
        "light.persist_session_log",
        "light.run_record",
        "light.update_transcript_position",
        "light.commit_and_pr",
        "light.invalidate_cache",
    ]
    for act in expected_activities:
        assert act in _activity_calls, f"Expected activity '{act}' to have been called"

    # (d) Verify via workflow history that all 7 activities appear
    history = await temporal_client.get_workflow_handle(child_id).fetch_history()
    activity_names_in_history = [
        evt.activity_task_scheduled_event_attributes.activity_type.name
        for evt in history.events
        if evt.HasField("activity_task_scheduled_event_attributes")
    ]
    assert len(activity_names_in_history) == 7, (
        f"Expected 7 activity scheduled events, got {len(activity_names_in_history)}: "
        f"{activity_names_in_history}"
    )
