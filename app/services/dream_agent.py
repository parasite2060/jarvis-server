from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

from pydantic_ai import Agent, RunContext
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.usage import RunUsage, UsageLimits

from app.config import settings
from app.core.logging import get_logger
from app.services.dream_models import ConsolidationOutput, DreamExtraction

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


def _count_tool_calls(messages: list[Any]) -> int:
    count = 0
    for msg in messages:
        for part in getattr(msg, "parts", []):
            if hasattr(part, "tool_name"):
                count += 1
    return count


async def run_dream_extraction(deps: DreamDeps) -> tuple[DreamExtraction, RunUsage, int]:
    agent = _get_agent()
    result = await agent.run(
        "Extract memories from the transcript using the available tools.",
        deps=deps,
        usage_limits=USAGE_LIMITS,
    )
    usage = result.usage()
    tool_call_count = _count_tool_calls(result.all_messages())
    return result.output, usage, tool_call_count


def extraction_to_dict(extraction: DreamExtraction) -> dict[str, Any]:
    data: dict[str, Any] = {
        "no_extract": extraction.no_extract,
        "summary": extraction.summary,
    }
    for category in MEMORY_CATEGORIES:
        items = getattr(extraction, category)
        data[category] = [item.model_dump() for item in items]
    return data


# ---------------------------------------------------------------------------
# Deep Dream Agent (memory consolidation)
# ---------------------------------------------------------------------------


@dataclass
class DeepDreamDeps:
    source_date: date
    memu_memories: list[dict[str, Any]]
    memory_md: str
    daily_log: str
    soul_md: str


def _load_deep_dream_prompt() -> str:
    return (_PROMPTS_DIR / "deep_dream_consolidate.md").read_text(encoding="utf-8")


_deep_dream_agent: Agent[DeepDreamDeps, ConsolidationOutput] | None = None


def _get_deep_dream_agent() -> Agent[DeepDreamDeps, ConsolidationOutput]:
    global _deep_dream_agent
    if _deep_dream_agent is not None:
        return _deep_dream_agent

    agent: Agent[DeepDreamDeps, ConsolidationOutput] = Agent(
        _build_model(),
        deps_type=DeepDreamDeps,
        output_type=ConsolidationOutput,
        instructions=_load_deep_dream_prompt(),
        retries=2,
        output_retries=3,
    )

    @agent.tool
    async def read_memory_file(ctx: RunContext[DeepDreamDeps]) -> str:
        """Return current MEMORY.md content."""
        return ctx.deps.memory_md

    @agent.tool
    async def read_daily_log(ctx: RunContext[DeepDreamDeps]) -> str:
        """Return today's daily log content."""
        return ctx.deps.daily_log

    @agent.tool
    async def query_memu_memories(ctx: RunContext[DeepDreamDeps]) -> str:
        """Return formatted MemU memories for today."""
        memories = ctx.deps.memu_memories
        if not memories:
            return "No MemU memories for today."
        lines: list[str] = []
        for i, mem in enumerate(memories, 1):
            content = mem.get("content", "")
            category = mem.get("category", "unknown")
            vault = mem.get("vault_target", "memory")
            source_date = mem.get("source_date", "unknown")
            lines.append(f"[{i}] ({category}/{vault}) {source_date}: {content}")
        return "\n".join(lines)

    @agent.tool
    async def read_soul_file(ctx: RunContext[DeepDreamDeps]) -> str:
        """Return SOUL.md alignment reference."""
        return ctx.deps.soul_md

    _deep_dream_agent = agent
    return _deep_dream_agent


DEEP_DREAM_USAGE_LIMITS = UsageLimits(total_tokens_limit=200_000, tool_calls_limit=25)


async def run_deep_dream_consolidation(
    deps: DeepDreamDeps,
) -> tuple[ConsolidationOutput, RunUsage, int]:
    agent = _get_deep_dream_agent()
    result = await agent.run(
        "Consolidate memories using the available tools. "
        "Read all inputs via tools before producing output.",
        deps=deps,
        usage_limits=DEEP_DREAM_USAGE_LIMITS,
    )
    usage = result.usage()
    tool_call_count = _count_tool_calls(result.all_messages())
    return result.output, usage, tool_call_count


def consolidation_to_dict(output: ConsolidationOutput) -> dict[str, Any]:
    return {
        "memory_md": output.memory_md,
        "daily_summary": output.daily_summary,
        "stats": output.stats.model_dump(),
        "vault_updates": {
            folder: [entry.model_dump() for entry in getattr(output.vault_updates, folder)]
            for folder in ("decisions", "projects", "patterns", "templates")
        },
    }
