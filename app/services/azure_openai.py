import json
import time
from pathlib import Path
from typing import Any

import openai
from openai import AsyncOpenAI

from app.config import settings
from app.core.exceptions import DreamError
from app.core.logging import get_logger

log = get_logger("jarvis.services.azure_openai")

_client: AsyncOpenAI | None = None
_prompt_cache: str | None = None


def _get_client() -> AsyncOpenAI:
    global _client  # noqa: PLW0603
    if _client is None:
        _client = AsyncOpenAI(
            base_url=settings.azure_openai_endpoint,
            api_key=settings.azure_openai_api_key,
        )
    return _client


def _load_prompt() -> str:
    global _prompt_cache  # noqa: PLW0603
    if _prompt_cache is None:
        prompt_path = Path(__file__).parent.parent.parent / "prompts" / "light_dream_extract.md"
        _prompt_cache = prompt_path.read_text(encoding="utf-8")
    return _prompt_cache


async def extract_memories(parsed_text: str) -> dict[str, Any]:
    client = _get_client()
    system_prompt = _load_prompt()

    log.info(
        "azure_openai.extract.started",
        transcript_length=len(parsed_text),
    )

    start_ms = time.monotonic_ns() // 1_000_000

    try:
        response = await client.chat.completions.create(
            model=settings.azure_openai_deployment,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": parsed_text},
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
        )
    except openai.APIConnectionError as exc:
        log.error("azure_openai.extract.error", error=str(exc), error_type="connection")
        raise DreamError(f"Azure OpenAI connection error: {exc}") from exc
    except openai.RateLimitError as exc:
        log.error("azure_openai.extract.error", error=str(exc), error_type="rate_limit")
        raise DreamError(f"Azure OpenAI rate limit: {exc}") from exc
    except openai.APIStatusError as exc:
        log.error(
            "azure_openai.extract.error",
            error=str(exc),
            error_type="api_status",
            status_code=exc.status_code,
        )
        raise DreamError(f"Azure OpenAI API error ({exc.status_code}): {exc}") from exc

    duration_ms = time.monotonic_ns() // 1_000_000 - start_ms

    content = response.choices[0].message.content
    if content is None:
        log.error("azure_openai.extract.error", error_type="empty_response")
        raise DreamError("Azure OpenAI returned empty response")

    try:
        parsed: dict[str, Any] = json.loads(content)
    except json.JSONDecodeError as exc:
        log.error("azure_openai.extract.error", error_type="json_parse")
        raise DreamError(f"Failed to parse Azure OpenAI response as JSON: {exc}") from exc

    no_extract = parsed.get("no_extract", False)
    if no_extract:
        log.info(
            "azure_openai.extract.no_extract",
            duration_ms=duration_ms,
        )
    else:
        memory_count = sum(
            len(parsed.get(cat, []))
            for cat in ("decisions", "preferences", "patterns", "corrections", "facts")
        )
        log.info(
            "azure_openai.extract.completed",
            memory_count=memory_count,
            duration_ms=duration_ms,
        )

    return parsed


async def close_client() -> None:
    global _client  # noqa: PLW0603
    if _client is not None:
        await _client.close()
        _client = None
