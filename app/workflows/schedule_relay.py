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

import datetime
from typing import Literal

from temporalio import workflow


def _iso_monday(date: datetime.date) -> str:
    """Return the ISO Monday of the week containing date."""
    monday = date - datetime.timedelta(days=date.weekday())
    return monday.isoformat()


@workflow.defn(name="ScheduleSignalRelay")
class ScheduleSignalRelayWorkflow:
    """Tiny relay workflow started by Temporal Schedules.

    Computes the date at fire time (using workflow.now() — deterministic Temporal
    primitive) and signals the DreamCoordinator singleton.
    """

    @workflow.run
    async def run(self, kind: Literal["deep", "weekly"]) -> None:
        fire_date = workflow.now().date()

        if kind == "deep":
            payload: dict[str, object] = {
                "trigger": "auto",
                "target_date": fire_date.isoformat(),
            }
            signal_name = "submit_deep"
        else:
            payload = {
                "trigger": "auto",
                "week_start": _iso_monday(fire_date),
            }
            signal_name = "submit_weekly"

        handle = workflow.get_external_workflow_handle("coord-singleton")
        await handle.signal(signal_name, payload)
