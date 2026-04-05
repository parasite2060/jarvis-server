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
_consolidate_prompt_cache: str | None = None


def _get_client() -> AsyncOpenAI:
    global _client  # noqa: PLW0603
    if _client is None:
        _client = AsyncOpenAI(
            base_url=settings.llm_base_url or settings.llm_endpoint,
            api_key=settings.llm_api_key,
        )
    return _client


_PROMPTS_DIR = Path("/app/prompts") if Path("/app/prompts").is_dir() else Path(__file__).parent.parent.parent / "prompts"


def _load_prompt() -> str:
    global _prompt_cache  # noqa: PLW0603
    if _prompt_cache is None:
        _prompt_cache = (_PROMPTS_DIR / "light_dream_extract.md").read_text(encoding="utf-8")
    return _prompt_cache


def _load_consolidate_prompt() -> str:
    global _consolidate_prompt_cache  # noqa: PLW0603
    if _consolidate_prompt_cache is None:
        _consolidate_prompt_cache = (_PROMPTS_DIR / "deep_dream_consolidate.md").read_text(encoding="utf-8")
    return _consolidate_prompt_cache


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
            model=settings.llm_model,
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


async def consolidate_memories(
    current_memory_md: str,
    daily_log: str,
    soul_md: str,
    memu_memories: list[dict[str, Any]],
) -> dict[str, Any]:
    client = _get_client()
    system_prompt = _load_consolidate_prompt()

    formatted_memories = "\n".join(f"- {m.get('content', str(m))}" for m in memu_memories)

    user_message = (
        f"## Current MEMORY.md\n{current_memory_md}\n\n"
        f"## Today's Daily Log\n{daily_log}\n\n"
        f"## SOUL.md (Reference - do not modify)\n{soul_md}\n\n"
        f"## Today's MemU Memories (All Sessions)\n{formatted_memories}"
    )

    log.info(
        "azure_openai.consolidate.started",
        memory_md_length=len(current_memory_md),
        daily_log_length=len(daily_log),
        memu_count=len(memu_memories),
    )

    start_ms = time.monotonic_ns() // 1_000_000

    try:
        response = await client.chat.completions.create(
            model=settings.llm_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
        )
    except openai.APIConnectionError as exc:
        log.error("azure_openai.consolidate.error", error=str(exc), error_type="connection")
        raise DreamError(f"Azure OpenAI connection error: {exc}") from exc
    except openai.RateLimitError as exc:
        log.error("azure_openai.consolidate.error", error=str(exc), error_type="rate_limit")
        raise DreamError(f"Azure OpenAI rate limit: {exc}") from exc
    except openai.APIStatusError as exc:
        log.error(
            "azure_openai.consolidate.error",
            error=str(exc),
            error_type="api_status",
            status_code=exc.status_code,
        )
        raise DreamError(f"Azure OpenAI API error ({exc.status_code}): {exc}") from exc

    duration_ms = time.monotonic_ns() // 1_000_000 - start_ms

    content = response.choices[0].message.content
    if content is None:
        log.error("azure_openai.consolidate.error", error_type="empty_response")
        raise DreamError("Azure OpenAI returned empty response for consolidation")

    try:
        parsed: dict[str, Any] = json.loads(content)
    except json.JSONDecodeError as exc:
        log.error("azure_openai.consolidate.error", error_type="json_parse")
        raise DreamError(f"Failed to parse consolidation response as JSON: {exc}") from exc

    memory_md = parsed.get("memory_md", "")
    if memory_md:
        line_count = len(memory_md.splitlines())
        if line_count > 200:
            log.warning(
                "azure_openai.consolidate.line_count_exceeded",
                line_count=line_count,
            )

    vault_defaults: dict[str, list[Any]] = {
        "decisions": [],
        "projects": [],
        "patterns": [],
        "templates": [],
    }
    if "vault_updates" not in parsed or parsed["vault_updates"] is None:
        parsed["vault_updates"] = vault_defaults
    else:
        for key in vault_defaults:
            if key not in parsed["vault_updates"]:
                parsed["vault_updates"][key] = []

    vault_counts = {
        folder: len(parsed["vault_updates"].get(folder, [])) for folder in vault_defaults
    }

    stats = parsed.get("stats", {})
    log.info(
        "azure_openai.consolidate.completed",
        duration_ms=duration_ms,
        total_memories_processed=stats.get("total_memories_processed", 0),
        duplicates_removed=stats.get("duplicates_removed", 0),
    )
    log.info("azure_openai.consolidate.vault_counts", **vault_counts)

    return parsed


async def close_client() -> None:
    global _client  # noqa: PLW0603
    if _client is not None:
        await _client.close()
        _client = None
