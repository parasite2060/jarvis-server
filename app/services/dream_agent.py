from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic_ai import Agent, RunContext
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.usage import UsageLimits

from app.config import settings
from app.core.logging import get_logger
from app.services.dream_models import DreamExtraction

log = get_logger("jarvis.services.dream_agent")

MEMORY_CATEGORIES = ("decisions", "preferences", "patterns", "corrections", "facts")

_PROMPTS_DIR = (
    Path("/app/prompts")
    if Path("/app/prompts").is_dir()
    else Path(__file__).parent.parent.parent / "prompts"
)


@dataclass
class DreamDeps:
    transcript_id: int
    parsed_lines: list[str]
    session_id: str
    project: str | None
    token_count: int | None
    created_at: datetime | None


def _load_system_prompt() -> str:
    return (_PROMPTS_DIR / "light_dream_extract.md").read_text(encoding="utf-8")


def _build_model() -> OpenAIChatModel:
    provider = OpenAIProvider(
        base_url=settings.llm_base_url or settings.llm_endpoint,
        api_key=settings.llm_api_key,
    )
    return OpenAIChatModel(settings.llm_model, provider=provider)


_dream_agent: Agent[DreamDeps, DreamExtraction] | None = None


def _get_agent() -> Agent[DreamDeps, DreamExtraction]:
    global _dream_agent
    if _dream_agent is not None:
        return _dream_agent

    agent: Agent[DreamDeps, DreamExtraction] = Agent(
        _build_model(),
        deps_type=DreamDeps,
        output_type=DreamExtraction,
        instructions=_load_system_prompt(),
        retries=2,
        output_retries=3,
    )

    @agent.tool
    async def get_transcript_stats(ctx: RunContext[DreamDeps]) -> dict[str, Any]:
        """Return transcript size stats for chunking strategy."""
        lines = ctx.deps.parsed_lines
        total_chars = sum(len(line) for line in lines)
        total_lines = len(lines)
        estimated_tokens = ctx.deps.token_count or (total_chars // 4)
        return {
            "total_chars": total_chars,
            "total_lines": total_lines,
            "estimated_tokens": estimated_tokens,
            "session_id": ctx.deps.session_id,
            "project": ctx.deps.project,
        }

    @agent.tool
    async def get_transcript_metadata(ctx: RunContext[DreamDeps]) -> dict[str, Any]:
        """Returns session metadata: session_id, project, created_at, token_count."""
        return {
            "session_id": ctx.deps.session_id,
            "project": ctx.deps.project,
            "created_at": ctx.deps.created_at.isoformat() if ctx.deps.created_at else None,
            "token_count": ctx.deps.token_count,
        }

    @agent.tool
    async def get_transcript_chunk(
        ctx: RunContext[DreamDeps], start_line: int, end_line: int
    ) -> str:
        """Returns transcript text from start_line to end_line (0-based, exclusive end)."""
        lines = ctx.deps.parsed_lines
        clamped_start = max(0, start_line)
        clamped_end = min(len(lines), end_line)
        return "\n".join(lines[clamped_start:clamped_end])

    _dream_agent = agent
    return _dream_agent


USAGE_LIMITS = UsageLimits(total_tokens_limit=150_000, tool_calls_limit=30)


async def run_dream_extraction(deps: DreamDeps) -> DreamExtraction:
    agent = _get_agent()
    result = await agent.run(
        "Extract memories from the transcript using the available tools.",
        deps=deps,
        usage_limits=USAGE_LIMITS,
    )
    return result.output


def extraction_to_dict(extraction: DreamExtraction) -> dict[str, Any]:
    data: dict[str, Any] = {
        "no_extract": extraction.no_extract,
        "summary": extraction.summary,
    }
    for category in MEMORY_CATEGORIES:
        items = getattr(extraction, category)
        data[category] = [item.model_dump() for item in items]
    return data
