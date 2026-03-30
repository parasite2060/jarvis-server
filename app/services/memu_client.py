from typing import Any

import httpx

from app.config import settings
from app.core.exceptions import MemuError, MemuUnavailableError
from app.core.logging import get_logger

log = get_logger("jarvis.services.memu_client")

_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client  # noqa: PLW0603
    if _client is None:
        _client = httpx.AsyncClient(
            base_url=settings.memu_base_url,
            timeout=httpx.Timeout(10.0),
        )
    return _client


async def close_client() -> None:
    global _client  # noqa: PLW0603
    if _client is not None:
        await _client.aclose()
        _client = None


async def memu_retrieve(query: str, method: str = "rag") -> dict[str, Any]:
    client = _get_client()
    try:
        response = await client.post(
            "/api/v3/memory/retrieve",
            json={"query": query, "method": method},
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        log.error(
            "memu_client.retrieve.error",
            status_code=exc.response.status_code,
            query_length=len(query),
        )
        raise MemuError(
            status_code=exc.response.status_code,
            detail=exc.response.text,
        ) from exc
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        log.error("memu_client.retrieve.unavailable", error=str(exc))
        raise MemuUnavailableError(detail=str(exc)) from exc

    result: dict[str, Any] = response.json()
    log.info(
        "memu_client.retrieve.success",
        query_length=len(query),
        method=method,
    )
    return result


async def memu_memorize(messages: list[dict[str, Any]]) -> dict[str, Any]:
    client = _get_client()
    try:
        response = await client.post(
            "/api/v3/memory/memorize",
            json={"messages": messages},
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        log.error(
            "memu_client.memorize.error",
            status_code=exc.response.status_code,
            message_count=len(messages),
        )
        raise MemuError(
            status_code=exc.response.status_code,
            detail=exc.response.text,
        ) from exc
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        log.error("memu_client.memorize.unavailable", error=str(exc))
        raise MemuUnavailableError(detail=str(exc)) from exc

    result: dict[str, Any] = response.json()
    log.info(
        "memu_client.memorize.success",
        message_count=len(messages),
    )
    return result
