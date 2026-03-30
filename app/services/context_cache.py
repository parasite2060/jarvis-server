import datetime

from app.core.logging import get_logger

log = get_logger("jarvis.services.context_cache")

CONTEXT_CACHE_TTL_SECONDS = 1800  # 30 minutes

_cache: dict[str, str] = {}
_expires_at: datetime.datetime | None = None


async def get_cached_context() -> str | None:
    global _expires_at

    if _expires_at is None or "context" not in _cache:
        log.debug("context_cache.miss", reason="empty")
        return None

    if datetime.datetime.now(tz=datetime.UTC) >= _expires_at:
        log.debug("context_cache.miss", reason="expired")
        _cache.clear()
        _expires_at = None
        return None

    log.debug("context_cache.hit")
    return _cache["context"]


async def set_cached_context(content: str) -> None:
    global _expires_at

    _cache["context"] = content
    _expires_at = datetime.datetime.now(tz=datetime.UTC) + datetime.timedelta(
        seconds=CONTEXT_CACHE_TTL_SECONDS
    )
    log.debug("context_cache.set", ttl_seconds=CONTEXT_CACHE_TTL_SECONDS)


async def invalidate_context_cache() -> None:
    global _expires_at

    _cache.clear()
    _expires_at = None
    log.info("context_cache.invalidated")
