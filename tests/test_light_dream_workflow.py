"""Tests for LightDreamWorkflow using temporalio.testing.WorkflowEnvironment.

Test approach:
  (a) Happy path: all 7 activities mocked via worker activity overrides.
  (b) commit_and_pr failure: stub always raises RuntimeError; assert invoked exactly
      max_attempts (3) times and workflow surfaces the underlying error.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from datetime import timedelta
from typing import Any

import pytest
from temporalio import activity
from temporalio.client import WorkflowFailureError
from temporalio.exceptions import ActivityError
from temporalio.testing import WorkflowEnvironment
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
from app.workflows.light_dream_workflow import LightDreamWorkflow

# ---- Call tracking shared between test and sandbox ----
_call_log: list[str] = []
_commit_attempts: int = 0
_commit_should_fail: bool = False

_SAMPLE_SESSION_LOG: dict = {
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
            "content": "test",
            "reasoning": None,
            "vault_target": "memory",
            "source_date": "2026-05-06",
        }
    ],
}


# ---- Stub activities ----


@activity.defn(name="light.load_transcript")
async def stub_load_transcript(payload: LightDreamPayload) -> LoadTranscriptResult:
    _call_log.append("load_transcript")
    return LoadTranscriptResult(
        dream_id=42,
        transcript_id=payload.transcript_id,
        session_id=payload.session_id,
        parsed_text="test transcript",
        project=None,
        token_count=100,
        is_continuation=False,
        segment_end_line=10,
        created_at_iso="2026-05-06T14:30:00+00:00",
    )


@activity.defn(name="light.run_extraction")
async def stub_run_extraction(inp: ExtractionInput) -> ExtractionAgentOutput:
    _call_log.append("run_extraction")
    return ExtractionAgentOutput(
        summary="test summary",
        no_extract=False,
        session_log_json=_SAMPLE_SESSION_LOG,
        input_tokens=100,
        output_tokens=50,
        total_tokens=150,
        tool_calls=2,
    )


@activity.defn(name="light.persist_session_log")
async def stub_persist_session_log(inp: PersistSessionLogInput) -> None:
    _call_log.append("persist_session_log")


@activity.defn(name="light.run_record")
async def stub_run_record(inp: RecordInput) -> RecordAgentOutput:
    _call_log.append("run_record")
    return RecordAgentOutput(
        files_modified=[FileModified(path="dailys/2026-05-06.md", action="update")],
        summary="Daily log updated",
        source_date_iso="2026-05-06",
    )


@activity.defn(name="light.update_transcript_position")
async def stub_update_transcript_position(inp: UpdatePositionInput) -> None:
    _call_log.append("update_transcript_position")


@activity.defn(name="light.commit_and_pr")
async def stub_commit_and_pr(inp: CommitAndPRInput) -> CommitAndPRResult:
    global _commit_attempts
    _commit_attempts += 1
    _call_log.append(f"commit_and_pr:{_commit_attempts}")
    if _commit_should_fail:
        raise RuntimeError("simulated commit failure")
    return CommitAndPRResult(
        git_branch=f"dream/light-{inp.session_id}",
        git_pr_url="https://github.com/example/pr/1",
        git_pr_status="created",
    )


@activity.defn(name="light.invalidate_cache")
async def stub_invalidate_cache(inp: InvalidateCacheInput) -> None:
    _call_log.append("invalidate_cache")


_ALL_STUBS = [
    stub_load_transcript,
    stub_run_extraction,
    stub_persist_session_log,
    stub_run_record,
    stub_update_transcript_position,
    stub_commit_and_pr,
    stub_invalidate_cache,
]

_SANDBOX_RESTRICTIONS = SandboxRestrictions.default.with_passthrough_modules(
    "tests.test_light_dream_workflow"
)


def _make_worker(client: Any, task_queue: str = "test-queue") -> Worker:
    return Worker(
        client,
        task_queue=task_queue,
        workflows=[LightDreamWorkflow],
        activities=_ALL_STUBS,
        workflow_runner=SandboxedWorkflowRunner(restrictions=_SANDBOX_RESTRICTIONS),
    )


@pytest.fixture
async def env() -> AsyncGenerator[WorkflowEnvironment, None]:
    async with await WorkflowEnvironment.start_time_skipping() as env:
        yield env


@pytest.fixture(autouse=True)
def reset_state() -> Any:
    global _call_log, _commit_attempts, _commit_should_fail
    _call_log = []
    _commit_attempts = 0
    _commit_should_fail = False
    yield
    _call_log = []
    _commit_attempts = 0
    _commit_should_fail = False


async def test_happy_path_all_activities_called_in_order(env: WorkflowEnvironment) -> None:
    """AC12a: All 7 activities called in order, result matches LightDreamResult shape."""
    async with _make_worker(env.client):
        result = await env.client.execute_workflow(
            LightDreamWorkflow.run,
            LightDreamPayload(transcript_id=1, session_id="test-session"),
            id="light-test-happy",
            task_queue="test-queue",
        )

    assert isinstance(result, LightDreamResult)
    assert result.dream_id == 42
    assert result.pr_url == "https://github.com/example/pr/1"

    # Verify all 7 activities called
    assert "load_transcript" in _call_log
    assert "run_extraction" in _call_log
    assert "persist_session_log" in _call_log
    assert "run_record" in _call_log
    assert "update_transcript_position" in _call_log
    assert "commit_and_pr:1" in _call_log
    assert "invalidate_cache" in _call_log

    # Verify order
    ordered = [
        "load_transcript",
        "run_extraction",
        "persist_session_log",
        "run_record",
        "update_transcript_position",
        "commit_and_pr:1",
        "invalidate_cache",
    ]
    call_positions = [_call_log.index(name) for name in ordered]
    assert call_positions == sorted(call_positions), "Activities not called in expected order"


async def test_happy_path_result_has_correct_dream_id(env: WorkflowEnvironment) -> None:
    """AC12a: Workflow result includes dream_id from load_transcript stub."""
    async with _make_worker(env.client):
        result = await env.client.execute_workflow(
            LightDreamWorkflow.run,
            LightDreamPayload(transcript_id=99, session_id="session-99"),
            id="light-test-dream-id",
            task_queue="test-queue",
        )

    assert result.dream_id == 42


async def test_no_extract_skips_downstream_activities(env: WorkflowEnvironment) -> None:
    """When extraction returns no_extract=True, persist/record/commit/cache are skipped."""

    @activity.defn(name="light.run_extraction")
    async def stub_no_extract(inp: ExtractionInput) -> ExtractionAgentOutput:
        _call_log.append("run_extraction_no_extract")
        return ExtractionAgentOutput(
            summary="",
            no_extract=True,
            session_log_json={},
            input_tokens=None,
            output_tokens=None,
            total_tokens=None,
            tool_calls=None,
        )

    no_extract_worker = Worker(
        env.client,
        task_queue="test-no-extract",
        workflows=[LightDreamWorkflow],
        activities=[
            stub_load_transcript,
            stub_no_extract,
            stub_persist_session_log,
            stub_run_record,
            stub_update_transcript_position,
            stub_commit_and_pr,
            stub_invalidate_cache,
        ],
        workflow_runner=SandboxedWorkflowRunner(restrictions=_SANDBOX_RESTRICTIONS),
    )
    async with no_extract_worker:
        result = await env.client.execute_workflow(
            LightDreamWorkflow.run,
            LightDreamPayload(transcript_id=1, session_id="no-extract"),
            id="light-test-no-extract",
            task_queue="test-no-extract",
        )

    assert result.dream_id == 42
    assert result.pr_url is None
    assert "persist_session_log" not in _call_log
    assert "run_record" not in _call_log
    assert "commit_and_pr:1" not in _call_log
    assert "invalidate_cache" not in _call_log


async def test_commit_and_pr_failure_retried_max_attempts(env: WorkflowEnvironment) -> None:
    """AC12b: commit_and_pr always raises; invoked exactly max_attempts (3) times."""
    global _commit_should_fail
    _commit_should_fail = True

    async with _make_worker(env.client):
        with pytest.raises(WorkflowFailureError) as exc_info:
            await env.client.execute_workflow(
                LightDreamWorkflow.run,
                LightDreamPayload(transcript_id=1, session_id="fail-session"),
                id="light-test-commit-fail",
                task_queue="test-queue",
                execution_timeout=timedelta(seconds=30),
            )

    assert _commit_attempts == 3, f"Expected 3 attempts, got {_commit_attempts}"
    # Verify the cause chain: WorkflowFailure → ActivityError → ApplicationError (RuntimeError)
    assert isinstance(exc_info.value.cause, ActivityError)
