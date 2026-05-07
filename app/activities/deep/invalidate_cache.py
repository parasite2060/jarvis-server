from __future__ import annotations

from temporalio import activity

from app.activities.deep._models import InvalidateCacheInput
from app.services.context_cache import invalidate_context_cache


@activity.defn(name="deep.invalidate_cache")
async def invalidate_cache(inp: InvalidateCacheInput) -> None:
    await invalidate_context_cache()
