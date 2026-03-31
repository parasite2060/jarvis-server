import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import openai
import pytest

from app.core.exceptions import DreamError
from app.services import azure_openai
from app.services.azure_openai import consolidate_memories


@pytest.fixture(autouse=True)
def _reset_module_state() -> None:
    azure_openai._client = None
    azure_openai._consolidate_prompt_cache = None


SAMPLE_CONSOLIDATION: dict[str, Any] = {
    "memory_md": "# Memory Index\n## Strong Patterns\n- Always READ before WRITE (5x)\n",
    "daily_summary": "Productive day of architecture decisions.",
    "stats": {
        "total_memories_processed": 10,
        "duplicates_removed": 3,
        "contradictions_resolved": 1,
        "patterns_promoted": 1,
        "stale_pruned": 2,
    },
}

SAMPLE_MEMORIES: list[dict[str, Any]] = [
    {"content": "Use FastAPI because async-first", "type": "decision"},
    {"content": "Prefer httpx over requests", "type": "preference"},
]


def _mock_completion(content: str) -> MagicMock:
    message = MagicMock()
    message.content = content
    choice = MagicMock()
    choice.message = message
    response = MagicMock()
    response.choices = [choice]
    return response


@pytest.mark.asyncio
async def test_consolidate_sends_correct_prompt_structure() -> None:
    mock_client = AsyncMock()
    mock_client.chat.completions.create = AsyncMock(
        return_value=_mock_completion(json.dumps(SAMPLE_CONSOLIDATION))
    )

    with (
        patch.object(azure_openai, "_get_client", return_value=mock_client),
        patch.object(azure_openai, "_load_consolidate_prompt", return_value="Consolidate prompt"),
    ):
        await consolidate_memories("memory md", "daily log", "soul md", SAMPLE_MEMORIES)

    call_kwargs = mock_client.chat.completions.create.call_args.kwargs
    assert call_kwargs["messages"][0]["role"] == "system"
    assert call_kwargs["messages"][0]["content"] == "Consolidate prompt"
    assert call_kwargs["messages"][1]["role"] == "user"
    user_content: str = call_kwargs["messages"][1]["content"]
    assert "## Current MEMORY.md" in user_content
    assert "memory md" in user_content
    assert "## Today's Daily Log" in user_content
    assert "## SOUL.md (Reference - do not modify)" in user_content
    assert "## Today's MemU Memories" in user_content
    assert call_kwargs["response_format"] == {"type": "json_object"}
    assert call_kwargs["temperature"] == 0.3


@pytest.mark.asyncio
async def test_consolidate_parses_valid_json_response() -> None:
    mock_client = AsyncMock()
    mock_client.chat.completions.create = AsyncMock(
        return_value=_mock_completion(json.dumps(SAMPLE_CONSOLIDATION))
    )

    with (
        patch.object(azure_openai, "_get_client", return_value=mock_client),
        patch.object(azure_openai, "_load_consolidate_prompt", return_value="prompt"),
    ):
        result = await consolidate_memories("mem", "log", "soul", SAMPLE_MEMORIES)

    assert "memory_md" in result
    assert "daily_summary" in result
    assert result["stats"]["total_memories_processed"] == 10
    assert result["stats"]["duplicates_removed"] == 3


@pytest.mark.asyncio
async def test_consolidate_raises_dream_error_on_api_failure() -> None:
    mock_client = AsyncMock()
    mock_client.chat.completions.create = AsyncMock(
        side_effect=openai.APIConnectionError(request=MagicMock())
    )

    with (
        patch.object(azure_openai, "_get_client", return_value=mock_client),
        patch.object(azure_openai, "_load_consolidate_prompt", return_value="prompt"),
    ):
        with pytest.raises(DreamError):
            await consolidate_memories("mem", "log", "soul", SAMPLE_MEMORIES)


@pytest.mark.asyncio
async def test_consolidate_raises_dream_error_on_empty_response() -> None:
    mock_client = AsyncMock()
    completion = _mock_completion("")
    completion.choices[0].message.content = None
    mock_client.chat.completions.create = AsyncMock(return_value=completion)

    with (
        patch.object(azure_openai, "_get_client", return_value=mock_client),
        patch.object(azure_openai, "_load_consolidate_prompt", return_value="prompt"),
    ):
        with pytest.raises(DreamError, match="empty response"):
            await consolidate_memories("mem", "log", "soul", SAMPLE_MEMORIES)


@pytest.mark.asyncio
async def test_consolidate_raises_dream_error_on_invalid_json() -> None:
    mock_client = AsyncMock()
    mock_client.chat.completions.create = AsyncMock(
        return_value=_mock_completion("not valid json {{{")
    )

    with (
        patch.object(azure_openai, "_get_client", return_value=mock_client),
        patch.object(azure_openai, "_load_consolidate_prompt", return_value="prompt"),
    ):
        with pytest.raises(DreamError, match="Failed to parse"):
            await consolidate_memories("mem", "log", "soul", SAMPLE_MEMORIES)


@pytest.mark.asyncio
async def test_consolidate_prompt_loaded_and_cached() -> None:
    mock_client = AsyncMock()
    mock_client.chat.completions.create = AsyncMock(
        return_value=_mock_completion(json.dumps(SAMPLE_CONSOLIDATION))
    )

    with (
        patch.object(azure_openai, "_get_client", return_value=mock_client),
        patch.object(
            azure_openai, "_load_consolidate_prompt", return_value="cached prompt"
        ) as mock_load,
    ):
        await consolidate_memories("mem", "log", "soul", SAMPLE_MEMORIES)
        await consolidate_memories("mem2", "log2", "soul2", SAMPLE_MEMORIES)

    assert mock_load.call_count == 2


@pytest.mark.asyncio
async def test_consolidate_raises_dream_error_on_rate_limit() -> None:
    mock_response = MagicMock()
    mock_response.status_code = 429
    mock_response.headers = {}
    mock_client = AsyncMock()
    mock_client.chat.completions.create = AsyncMock(
        side_effect=openai.RateLimitError(
            message="Rate limited",
            response=mock_response,
            body=None,
        )
    )

    with (
        patch.object(azure_openai, "_get_client", return_value=mock_client),
        patch.object(azure_openai, "_load_consolidate_prompt", return_value="prompt"),
    ):
        with pytest.raises(DreamError):
            await consolidate_memories("mem", "log", "soul", SAMPLE_MEMORIES)
