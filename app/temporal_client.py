import asyncio
from typing import Any, Literal

from temporalio.client import Client
from temporalio.common import WorkflowIDReusePolicy

from app.config import settings
from app.core.logging import get_logger

log = get_logger("jarvis.temporal_client")

_client: Client | None = None
_lock: asyncio.Lock = asyncio.Lock()


async def get_temporal_client() -> Client:
    global _client
    async with _lock:
        if _client is None:
            _client = await Client.connect(
                target_host=settings.temporal_address,
                namespace=settings.temporal_namespace,
            )
    return _client


async def close_temporal_client() -> None:
    global _client
    _client = None


async def ensure_coordinator_running(client: Client) -> None:
    from app.workflows.coordinator import DreamCoordinatorWorkflow

    await client.start_workflow(
        DreamCoordinatorWorkflow.run,
        id="coord-singleton",
        task_queue=settings.temporal_task_queue,
        id_reuse_policy=WorkflowIDReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
    )


async def signal_coordinator(
    kind: Literal["light", "deep", "weekly"], payload: dict[str, Any]
) -> None:
    client = await get_temporal_client()
    handle = client.get_workflow_handle("coord-singleton")
    await handle.signal(f"submit_{kind}", payload)
