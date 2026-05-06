from collections.abc import Callable
from typing import Any

from temporalio.client import Client
from temporalio.worker import Worker

from app.config import settings


def build_temporal_worker(
    client: Client,
    *,
    workflows: list[type] | None = None,
    activities: list[Callable[..., Any]] | None = None,
) -> Worker | None:
    resolved_workflows = workflows or []
    resolved_activities = activities or []
    if not resolved_workflows and not resolved_activities:
        # SDK 1.7+ requires at least one workflow or activity; worker is deferred until
        # Story 12.2 registers the first workflow.
        return None
    return Worker(
        client,
        task_queue=settings.temporal_task_queue,
        workflows=resolved_workflows,
        activities=resolved_activities,
    )
