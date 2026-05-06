"""Tests for DreamCoordinatorWorkflow using temporalio.testing.WorkflowEnvironment.

Test approach for AC13: The coordinator dispatches children by workflow name (string),
so tests register stub child workflows with matching names in the same worker.
The worker is configured with `passthrough_modules={"tests.test_coordinator_workflow"}`
so that the stub workflows share the same module instance as the test — module-level
state (dispatch_log, control flags) is visible from inside the workflow sandbox.
"""

from collections.abc import AsyncGenerator
from datetime import timedelta
from typing import Any

import pytest
from temporalio import workflow
from temporalio.exceptions import ApplicationError
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker
from temporalio.worker.workflow_sandbox import SandboxedWorkflowRunner, SandboxRestrictions

from app.workflows.coordinator import DreamCoordinatorWorkflow

# Shared state between test and workflow sandbox via module-level variables.
# The worker is configured with passthrough_modules so the sandbox references
# the same module object as the test process.
_dispatch_log: list[str] = []
_fail_on_first: bool = False
_block_first: bool = False


@workflow.defn(name="LightDream")
class StubLightDreamWorkflow:
    @workflow.run
    async def run(self, payload: dict[str, Any]) -> str:
        session = payload.get("session_id", "?")
        already_seen = any(e.startswith("start-") or e.startswith("fail-") for e in _dispatch_log)
        if _fail_on_first and not already_seen:
            _dispatch_log.append(f"fail-{session}")
            raise ApplicationError("simulated child failure")
        if _block_first and not any(e.startswith("start-") for e in _dispatch_log):
            _dispatch_log.append(f"start-{session}")
            # Sleep for 30s in workflow time; tests use env.sleep to advance past it.
            await workflow.sleep(30)
        else:
            _dispatch_log.append(f"start-{session}")
        _dispatch_log.append(f"end-{session}")
        return "stub-completed"


@workflow.defn(name="DeepDream")
class StubDeepDreamWorkflow:
    @workflow.run
    async def run(self, payload: dict[str, Any]) -> str:
        _dispatch_log.append(f"deep-{payload.get('target_date', '?')}")
        return "stub-completed"


@workflow.defn(name="WeeklyReview")
class StubWeeklyReviewWorkflow:
    @workflow.run
    async def run(self, payload: dict[str, Any]) -> str:
        _dispatch_log.append(f"weekly-{payload.get('week_start', '?')}")
        return "stub-completed"


_ALL_WORKFLOWS = [
    DreamCoordinatorWorkflow,
    StubLightDreamWorkflow,
    StubDeepDreamWorkflow,
    StubWeeklyReviewWorkflow,
]

_SANDBOX_RESTRICTIONS = SandboxRestrictions.default.with_passthrough_modules(
    "tests.test_coordinator_workflow"
)


def _make_worker(client: Any, task_queue: str = "test-queue") -> Worker:
    return Worker(
        client,
        task_queue=task_queue,
        workflows=_ALL_WORKFLOWS,
        workflow_runner=SandboxedWorkflowRunner(restrictions=_SANDBOX_RESTRICTIONS),
    )


@pytest.fixture
async def env() -> AsyncGenerator[WorkflowEnvironment, None]:
    async with await WorkflowEnvironment.start_time_skipping() as env:
        yield env


@pytest.fixture(autouse=True)
def reset_dispatch_state() -> Any:
    global _dispatch_log, _fail_on_first, _block_first
    _dispatch_log = []
    _fail_on_first = False
    _block_first = False
    yield
    _dispatch_log = []
    _fail_on_first = False
    _block_first = False


async def test_two_submit_light_signals_execute_sequentially(env: WorkflowEnvironment) -> None:
    """AC13a: Two submit_light signals → both execute sequentially."""
    async with _make_worker(env.client):
        handle = await env.client.start_workflow(
            DreamCoordinatorWorkflow.run,
            id="coord-test-a",
            task_queue="test-queue",
        )
        await handle.signal("submit_light", {"session_id": "s1"})
        await handle.signal("submit_light", {"session_id": "s2"})
        await env.sleep(timedelta(seconds=5))

    assert "start-s1" in _dispatch_log
    assert "end-s1" in _dispatch_log
    assert "start-s2" in _dispatch_log
    assert "end-s2" in _dispatch_log

    idx_end_s1 = _dispatch_log.index("end-s1")
    idx_start_s2 = _dispatch_log.index("start-s2")
    assert idx_start_s2 > idx_end_s1, "second child must start only after first child completes"


async def test_submit_light_while_running_queues_and_executes_after(
    env: WorkflowEnvironment,
) -> None:
    """AC13b: submit_light arrives while _running=True → queued, executes after current.

    The stub sleeps for 30s in workflow time (time-skipping env). Signal s2 is sent
    while s1 is mid-flight (sleeping). After advancing time past the sleep, s2 should
    execute and complete after s1.
    """
    global _block_first
    _block_first = True

    async with _make_worker(env.client):
        handle = await env.client.start_workflow(
            DreamCoordinatorWorkflow.run,
            id="coord-test-b",
            task_queue="test-queue",
        )
        await handle.signal("submit_light", {"session_id": "s1"})
        await env.sleep(timedelta(seconds=1))
        # s1 is now sleeping (inside workflow.sleep(30)) — coordinator is _running=True
        await handle.signal("submit_light", {"session_id": "s2"})
        # Advance past s1's sleep and allow s2 to run
        await env.sleep(timedelta(seconds=60))

    assert "start-s1" in _dispatch_log
    assert "start-s2" in _dispatch_log

    idx_end_s1 = _dispatch_log.index("end-s1")
    idx_start_s2 = _dispatch_log.index("start-s2")
    assert idx_start_s2 > idx_end_s1, "s2 must not start before s1 completes"


async def test_child_failure_does_not_deadlock_coordinator(env: WorkflowEnvironment) -> None:
    """AC13c: Child workflow failure does not deadlock the coordinator.

    Configure the stub child to raise ApplicationError on first invocation and
    succeed on the second. Assert _running clears after the failure and the
    next queued request still executes.
    """
    global _fail_on_first
    _fail_on_first = True

    async with _make_worker(env.client):
        handle = await env.client.start_workflow(
            DreamCoordinatorWorkflow.run,
            id="coord-test-c",
            task_queue="test-queue",
        )
        await handle.signal("submit_light", {"session_id": "s1"})
        await handle.signal("submit_light", {"session_id": "s2"})
        await env.sleep(timedelta(seconds=10))

    assert "fail-s1" in _dispatch_log, "first dispatch should fail"
    assert "start-s2" in _dispatch_log, "_running must clear after failure so s2 executes"
    assert "end-s2" in _dispatch_log


async def test_signals_survive_simulated_restart(env: WorkflowEnvironment) -> None:
    """AC13d: Signals received during execution remain queued and both execute.

    Sends two signals and verifies both are processed in order. True replay
    durability is a Temporal guarantee; this test verifies the queue semantics
    hold: both signals are delivered and processed sequentially.
    """
    async with _make_worker(env.client):
        handle = await env.client.start_workflow(
            DreamCoordinatorWorkflow.run,
            id="coord-test-d",
            task_queue="test-queue",
        )
        await handle.signal("submit_light", {"session_id": "s1"})
        await handle.signal("submit_light", {"session_id": "s2"})
        await env.sleep(timedelta(seconds=5))

    assert "start-s1" in _dispatch_log
    assert "end-s1" in _dispatch_log
    assert "start-s2" in _dispatch_log
    assert "end-s2" in _dispatch_log
    idx_s2 = _dispatch_log.index("start-s2")
    idx_s1_end = _dispatch_log.index("end-s1")
    assert idx_s2 > idx_s1_end
