import asyncio

from temporalio.client import Client

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
