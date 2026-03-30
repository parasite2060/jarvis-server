import json
from unittest.mock import AsyncMock, MagicMock, patch

import openai
import pytest

from app.core.exceptions import DreamError
from app.services import azure_openai
from app.services.azure_openai import extract_memories


@pytest.fixture(autouse=True)
def _reset_module_state() -> None:
    azure_openai._client = None
    azure_openai._prompt_cache = None


SAMPLE_EXTRACTION = {
    "no_extract": False,
    "summary": "Discussed FastAPI architecture decisions",
    "decisions": [
        {
            "content": "Use FastAPI because async-first",
            "reasoning": "async-first and Pydantic integration",
            "vault_target": "decisions",
            "source_date": "2026-03-31",
        }
    ],
    "preferences": [
        {
            "content": "Prefer httpx over requests",
            "vault_target": "memory",
            "source_date": "2026-03-31",
        }
    ],
    "patterns": [],
    "corrections": [],
    "facts": [
        {
            "content": "Project uses PostgreSQL with pgvector",
            "vault_target": "memory",
            "source_date": "2026-03-31",
        }
    ],
}

NO_EXTRACT_RESPONSE = {
    "no_extract": True,
    "summary": "Quick fix, no meaningful insights",
    "decisions": [],
    "preferences": [],
    "patterns": [],
    "corrections": [],
    "facts": [],
}


def _mock_completion(content: str) -> MagicMock:
    message = MagicMock()
    message.content = content
    choice = MagicMock()
    choice.message = message
    response = MagicMock()
    response.choices = [choice]
    return response


@pytest.mark.asyncio
async def test_extract_memories_sends_correct_prompt_structure() -> None:
    mock_client = AsyncMock()
    mock_client.chat.completions.create = AsyncMock(
        return_value=_mock_completion(json.dumps(SAMPLE_EXTRACTION))
    )

    with (
        patch.object(azure_openai, "_get_client", return_value=mock_client),
        patch.object(azure_openai, "_load_prompt", return_value="System prompt here"),
    ):
        await extract_memories("User: hello\n\nAssistant: hi")

    call_kwargs = mock_client.chat.completions.create.call_args.kwargs
    assert call_kwargs["messages"][0]["role"] == "system"
    assert call_kwargs["messages"][0]["content"] == "System prompt here"
    assert call_kwargs["messages"][1]["role"] == "user"
    assert call_kwargs["messages"][1]["content"] == "User: hello\n\nAssistant: hi"
    assert call_kwargs["response_format"] == {"type": "json_object"}
    assert call_kwargs["temperature"] == 0.3


@pytest.mark.asyncio
async def test_extract_memories_parses_valid_json_response() -> None:
    mock_client = AsyncMock()
    mock_client.chat.completions.create = AsyncMock(
        return_value=_mock_completion(json.dumps(SAMPLE_EXTRACTION))
    )

    with (
        patch.object(azure_openai, "_get_client", return_value=mock_client),
        patch.object(azure_openai, "_load_prompt", return_value="prompt"),
    ):
        result = await extract_memories("transcript text")

    assert result["no_extract"] is False
    assert len(result["decisions"]) == 1
    assert result["decisions"][0]["reasoning"] == "async-first and Pydantic integration"
    assert len(result["preferences"]) == 1
    assert len(result["facts"]) == 1
    assert result["summary"] == "Discussed FastAPI architecture decisions"


@pytest.mark.asyncio
async def test_extract_memories_handles_no_extract() -> None:
    mock_client = AsyncMock()
    mock_client.chat.completions.create = AsyncMock(
        return_value=_mock_completion(json.dumps(NO_EXTRACT_RESPONSE))
    )

    with (
        patch.object(azure_openai, "_get_client", return_value=mock_client),
        patch.object(azure_openai, "_load_prompt", return_value="prompt"),
    ):
        result = await extract_memories("quick fix transcript")

    assert result["no_extract"] is True
    assert result["decisions"] == []
    assert result["preferences"] == []


@pytest.mark.asyncio
async def test_extract_memories_raises_dream_error_on_connection_error() -> None:
    mock_client = AsyncMock()
    mock_client.chat.completions.create = AsyncMock(
        side_effect=openai.APIConnectionError(request=MagicMock())
    )

    with (
        patch.object(azure_openai, "_get_client", return_value=mock_client),
        patch.object(azure_openai, "_load_prompt", return_value="prompt"),
    ):
        with pytest.raises(DreamError):
            await extract_memories("transcript")


@pytest.mark.asyncio
async def test_extract_memories_raises_dream_error_on_rate_limit() -> None:
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
        patch.object(azure_openai, "_load_prompt", return_value="prompt"),
    ):
        with pytest.raises(DreamError):
            await extract_memories("transcript")


@pytest.mark.asyncio
async def test_extract_memories_raises_dream_error_on_api_status_error() -> None:
    mock_response = MagicMock()
    mock_response.status_code = 500
    mock_response.headers = {}
    mock_client = AsyncMock()
    mock_client.chat.completions.create = AsyncMock(
        side_effect=openai.APIStatusError(
            message="Internal server error",
            response=mock_response,
            body=None,
        )
    )

    with (
        patch.object(azure_openai, "_get_client", return_value=mock_client),
        patch.object(azure_openai, "_load_prompt", return_value="prompt"),
    ):
        with pytest.raises(DreamError):
            await extract_memories("transcript")


@pytest.mark.asyncio
async def test_prompt_file_is_loaded_and_cached() -> None:
    mock_client = AsyncMock()
    mock_client.chat.completions.create = AsyncMock(
        return_value=_mock_completion(json.dumps(SAMPLE_EXTRACTION))
    )

    prompt_content = "Cached system prompt"
    with (
        patch.object(azure_openai, "_get_client", return_value=mock_client),
        patch.object(azure_openai, "_load_prompt", return_value=prompt_content) as mock_load,
    ):
        await extract_memories("transcript 1")
        await extract_memories("transcript 2")

    assert mock_load.call_count == 2


@pytest.mark.asyncio
async def test_extract_memories_raises_on_empty_response() -> None:
    mock_client = AsyncMock()
    completion = _mock_completion("")
    completion.choices[0].message.content = None
    mock_client.chat.completions.create = AsyncMock(return_value=completion)

    with (
        patch.object(azure_openai, "_get_client", return_value=mock_client),
        patch.object(azure_openai, "_load_prompt", return_value="prompt"),
    ):
        with pytest.raises(DreamError, match="empty response"):
            await extract_memories("transcript")


@pytest.mark.asyncio
async def test_extract_memories_raises_on_invalid_json() -> None:
    mock_client = AsyncMock()
    mock_client.chat.completions.create = AsyncMock(
        return_value=_mock_completion("not valid json {{{")
    )

    with (
        patch.object(azure_openai, "_get_client", return_value=mock_client),
        patch.object(azure_openai, "_load_prompt", return_value="prompt"),
    ):
        with pytest.raises(DreamError, match="Failed to parse"):
            await extract_memories("transcript")
