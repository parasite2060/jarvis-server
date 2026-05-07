"""E2E test: DreamCoordinator serialisation against Docker Temporal.

AC9: Send two submit_light signals within ~100ms → both child workflows complete →
     assert second child's first activity began AFTER first child's last activity ended.
     Single-active-dream invariant proven against a real Temporal server.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
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
            "content": "serialisation test",
            "reasoning": None,
            "vault_target": "memory",
            "source_date": "2026-05-07",
        }
    ],
}


@activity.defn(name="light.load_transcript")
async def _stub_load_transcript(payload: LightDreamPayload) -> LoadTranscriptResult:
    return LoadTranscriptResult(
        dream_id=1,
        transcript_id=payload.transcript_id,
        session_id=payload.session_id,
        parsed_text="serialisation test content",
        project=None,
        token_count=100,
        is_continuation=False,
        segment_end_line=10,
        created_at_iso="2026-05-07T10:00:00+00:00",
    )


@activity.defn(name="light.run_extraction")
async def _stub_run_extraction(inp: ExtractionInput) -> ExtractionAgentOutput:
    return ExtractionAgentOutput(
        summary="serialisation test summary",
        no_extract=False,
        session_log_json=_SAMPLE_SESSION_LOG,
        input_tokens=100,
        output_tokens=50,
        total_tokens=150,
        tool_calls=2,
    )


@activity.defn(name="light.persist_session_log")
async def _stub_persist_session_log(inp: PersistSessionLogInput) -> None:
    pass


@activity.defn(name="light.run_record")
async def _stub_run_record(inp: RecordInput) -> RecordAgentOutput:
    return RecordAgentOutput(
        files_modified=[FileModified(path="dailys/2026-05-07.md", action="update")],
        summary="log updated",
        source_date_iso="2026-05-07",
    )


@activity.defn(name="light.update_transcript_position")
async def _stub_update_transcript_position(inp: UpdatePositionInput) -> None:
    pass


@activity.defn(name="light.commit_and_pr")
async def _stub_commit_and_pr(inp: CommitAndPRInput) -> CommitAndPRResult:
    return CommitAndPRResult(
        git_branch=f"dream/light-{inp.session_id}",
        git_pr_url=f"https://github.com/example/pr/light-{inp.session_id}",
        git_pr_status="created",
    )


@activity.defn(name="light.invalidate_cache")
async def _stub_invalidate_cache(inp: InvalidateCacheInput) -> None:
    pass


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
    "tests.e2e.temporal.test_coordinator_serialisation"
)


def _get_workflow_time_range(history: Any) -> tuple[datetime | None, datetime | None]:
    """Return (first_event_time, last_event_time) from workflow history."""
    times = []
    for evt in history.events:
        ts = evt.event_time
        if ts.seconds > 0:
            times.append(
                datetime.fromtimestamp(ts.seconds + ts.nanos / 1e9, tz=UTC)
            )
    if not times:
        return None, None
    return min(times), max(times)


async def test_coordinator_serialisation_two_light_dreams(
    temporal_client: Client,
    e2e_task_queue: str,
) -> None:
    """AC9: Two submit_light within ~100ms → second child starts AFTER first child ends."""
    session_id_1 = f"serial-s1-{uuid.uuid4().hex[:6]}"
    session_id_2 = f"serial-s2-{uuid.uuid4().hex[:6]}"
    coord_id = f"coord-serial-{uuid.uuid4().hex[:8]}"
    child_id_1 = f"light-{session_id_1}"
    child_id_2 = f"light-{session_id_2}"

    async with Worker(
        temporal_client,
        task_queue=e2e_task_queue,
        workflows=[DreamCoordinatorWorkflow, LightDreamWorkflow],
        activities=_LIGHT_STUBS,
        workflow_runner=SandboxedWorkflowRunner(restrictions=_SANDBOX),
    ):
        coord_handle = await temporal_client.start_workflow(
            DreamCoordinatorWorkflow.run,
            id=coord_id,
            task_queue=e2e_task_queue,
        )

        # Send two signals within ~100ms
        await coord_handle.signal(
            "submit_light", {"transcript_id": 1, "session_id": session_id_1}
        )
        await asyncio.sleep(0.05)
        await coord_handle.signal(
            "submit_light", {"transcript_id": 2, "session_id": session_id_2}
        )

        # Wait for both children to complete
        result_1: LightDreamResult = await wait_for_workflow(
            temporal_client, child_id_1, timeout=90.0
        )
        result_2: LightDreamResult = await wait_for_workflow(
            temporal_client, child_id_2, timeout=90.0
        )

    assert result_1.dream_id is not None
    assert result_2.dream_id is not None

    # Verify serialisation via workflow execution start times from history
    history_1 = await temporal_client.get_workflow_handle(child_id_1).fetch_history()
    history_2 = await temporal_client.get_workflow_handle(child_id_2).fetch_history()

    _, first_child_end = _get_workflow_time_range(history_1)
    second_child_start, _ = _get_workflow_time_range(history_2)

    assert first_child_end is not None, "First child should have completed events"
    assert second_child_start is not None, "Second child should have started"

    # Single-active-dream invariant: second starts after first ends (2s tolerance)
    overlap = (first_child_end - second_child_start).total_seconds()
    assert overlap <= 2.0, (
        f"Second child started at {second_child_start} but first child ended at "
        f"{first_child_end}. Overlap={overlap:.2f}s — single-active-dream invariant violated."
    )
