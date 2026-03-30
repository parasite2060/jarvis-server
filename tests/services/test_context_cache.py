import datetime

import pytest

from app.services import context_cache
from app.services.context_cache import (
    get_cached_context,
    invalidate_context_cache,
    set_cached_context,
)


@pytest.fixture(autouse=True)
def _clear_cache() -> None:
    context_cache._cache.clear()
    context_cache._expires_at = None


@pytest.mark.asyncio
async def test_cache_miss_when_empty() -> None:
    result = await get_cached_context()

    assert result is None


@pytest.mark.asyncio
async def test_cache_hit_after_set() -> None:
    await set_cached_context("test context")

    result = await get_cached_context()

    assert result == "test context"


@pytest.mark.asyncio
async def test_cache_miss_after_expiry(monkeypatch: pytest.MonkeyPatch) -> None:
    await set_cached_context("test context")

    # Simulate TTL expiry by setting expires_at to the past
    past = datetime.datetime.now(tz=datetime.UTC) - datetime.timedelta(seconds=1)
    context_cache._expires_at = past

    result = await get_cached_context()

    assert result is None


@pytest.mark.asyncio
async def test_invalidate_clears_cache() -> None:
    await set_cached_context("test context")

    await invalidate_context_cache()

    result = await get_cached_context()
    assert result is None


@pytest.mark.asyncio
async def test_set_updates_existing_cache() -> None:
    await set_cached_context("first")
    await set_cached_context("second")

    result = await get_cached_context()

    assert result == "second"
