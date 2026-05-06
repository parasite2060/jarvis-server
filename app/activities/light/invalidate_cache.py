from __future__ import annotations

from temporalio import activity

from app.activities.light._models import InvalidateCacheInput


@activity.defn(name="light.invalidate_cache")
async def invalidate_cache(inp: InvalidateCacheInput) -> None:
    from app.services.context_cache import invalidate_context_cache

    await invalidate_context_cache()
