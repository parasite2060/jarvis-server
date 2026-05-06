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

# SINGLE-ACTIVE-DREAM INVARIANT
# ----------------------------
# At most one dream workflow runs at any wall-clock instant.
# Proof:
#   1. There is exactly one DreamCoordinatorWorkflow with workflow ID "coord-singleton".
#      `WorkflowIDReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY` prevents creation of a second.
#   2. The coordinator's `run()` is the only consumer of `self._queue`.
#   3. Inside the loop body, `_running = True` is set BEFORE `execute_child_workflow`
#      and `_running = False` is set AFTER it returns (in a try/finally).
#   4. `execute_child_workflow` is awaited synchronously — the next iteration cannot
#      begin until the current child has terminated.
#   5. Therefore, between any two consecutive iterations, the previous child has
#      terminated. There is no point in time at which two children are mid-flight.
# QED. The single-active-dream invariant holds.

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Any, Literal

from temporalio import workflow

# Workflow name → (child_workflow_name, child_id_key) mapping.
# Resolved by kind at dispatch time. Child workflow names correspond to the
# `name=` argument in each child's @workflow.defn decorator (stories 12.3-12.5).
_KIND_CONFIG: dict[str, tuple[str, str]] = {
    "light": ("LightDream", "session_id"),
    "deep": ("DeepDream", "target_date"),
    "weekly": ("WeeklyReview", "week_start"),
}

# ID prefix per kind (deterministic, matches §2 of temporal-workflows.md).
_KIND_ID_PREFIX: dict[str, str] = {
    "light": "light",
    "deep": "deep",
    "weekly": "weekly",
}


@dataclass
class DreamRequest:
    kind: Literal["light", "deep", "weekly"]
    payload: dict[str, Any]


@workflow.defn(name="DreamCoordinator")
class DreamCoordinatorWorkflow:
    def __init__(self) -> None:
        self._queue: deque[DreamRequest] = deque()
        self._running: bool = False

    @workflow.signal
    async def submit_light(self, payload: dict[str, Any]) -> None:
        self._queue.append(DreamRequest(kind="light", payload=payload))

    @workflow.signal
    async def submit_deep(self, payload: dict[str, Any]) -> None:
        self._queue.append(DreamRequest(kind="deep", payload=payload))

    @workflow.signal
    async def submit_weekly(self, payload: dict[str, Any]) -> None:
        self._queue.append(DreamRequest(kind="weekly", payload=payload))

    @workflow.run
    async def run(self) -> None:
        task_queue = workflow.info().task_queue
        while True:
            await workflow.wait_condition(lambda: bool(self._queue))
            req = self._queue.popleft()
            self._running = True
            try:
                await self._dispatch_child(req, task_queue)
            except Exception:  # noqa: BLE001
                pass
            finally:
                self._running = False

    async def _dispatch_child(self, req: DreamRequest, task_queue: str) -> None:
        if req.kind not in _KIND_CONFIG:
            from temporalio.exceptions import ApplicationError

            raise ApplicationError(f"unknown dream kind: {req.kind}")

        child_workflow_name, id_key = _KIND_CONFIG[req.kind]
        prefix = _KIND_ID_PREFIX[req.kind]
        child_id = f"{prefix}-{req.payload[id_key]}"

        await workflow.execute_child_workflow(
            child_workflow_name,
            req.payload,
            id=child_id,
            task_queue=task_queue,
        )
