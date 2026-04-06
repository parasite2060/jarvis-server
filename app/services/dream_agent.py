from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Any

from pydantic_ai import Agent, RunContext
from pydantic_ai.messages import ModelMessage, ModelRequest, ModelResponse, ToolReturnPart
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.usage import RunUsage, UsageLimits

from app.config import settings
from app.core.logging import get_logger
from app.services.dream_models import (
    ALLOWED_VAULT_TARGETS,
    ExtractionSummary,
    MemoryItem,
    MergeResult,
)

log = get_logger("jarvis.services.dream_agent")

MEMORY_CATEGORIES = ("decisions", "preferences", "patterns", "corrections", "facts")

_PROMPTS_DIR = (
    Path("/app/prompts")
    if Path("/app/prompts").is_dir()
    else Path(__file__).parent.parent.parent / "prompts"
)

# ---------------------------------------------------------------------------
# Path safety
# ---------------------------------------------------------------------------


def _safe_resolve(workspace: Path, relative: str) -> Path:
    resolved = (workspace / relative).resolve()
    if not resolved.is_relative_to(workspace.resolve()):
        raise ValueError(f"Path traversal blocked: {relative}")
    return resolved


# ---------------------------------------------------------------------------
# Shared model builder
# ---------------------------------------------------------------------------


def _build_model() -> OpenAIChatModel:
    provider = OpenAIProvider(
        base_url=settings.llm_base_url or settings.llm_endpoint,
        api_key=settings.llm_api_key,
    )
    return OpenAIChatModel(settings.llm_model, provider=provider)


# ---------------------------------------------------------------------------
# History compaction
# ---------------------------------------------------------------------------

COMPACT_THRESHOLD_CHARS = 320_000  # ~80k tokens
KEEP_RECENT_MESSAGES = 6  # keep last 3 request/response pairs intact


def compact_history(messages: list[ModelMessage]) -> list[ModelMessage]:
    total_chars = sum(
        len(str(getattr(part, "content", "")))
        for msg in messages
        for part in getattr(msg, "parts", [])
    )
    if total_chars < COMPACT_THRESHOLD_CHARS:
        return messages

    cutoff = max(0, len(messages) - KEEP_RECENT_MESSAGES)
    compacted = 0
    result: list[ModelMessage] = []

    for i, msg in enumerate(messages):
        if i >= cutoff or not isinstance(msg, ModelRequest):
            result.append(msg)
            continue

        new_parts = []
        for part in msg.parts:
            if isinstance(part, ToolReturnPart):
                content_str = str(part.content)
                if len(content_str) > 200:
                    compacted += len(content_str)
                    compact_label = f"[Compacted: {part.tool_name}, ~{len(content_str)} chars]"
                    new_parts.append(
                        ToolReturnPart(
                            tool_name=part.tool_name,
                            content=compact_label,
                            tool_call_id=part.tool_call_id,
                            timestamp=part.timestamp,
                        )
                    )
                    continue
            new_parts.append(part)

        result.append(ModelRequest(parts=new_parts))

    if compacted > 0:
        log.info("dream_agent.history_compacted", compacted_chars=compacted)

    return result


# ---------------------------------------------------------------------------
# Tool call counter
# ---------------------------------------------------------------------------


def _count_tool_calls(messages: list[Any]) -> int:
    count = 0
    for msg in messages:
        for part in getattr(msg, "parts", []):
            if hasattr(part, "tool_name") and isinstance(msg, ModelResponse):
                count += 1
    return count


# ---------------------------------------------------------------------------
# Generic file tools (reused by both agents)
# ---------------------------------------------------------------------------


def _register_file_tools(
    agent: Agent[Any, Any],
    *,
    allow_write: bool = False,
) -> None:
    @agent.tool
    async def read_file(
        ctx: RunContext[Any], path: str, offset: int = 0, limit: int = 200
    ) -> str:
        """Read lines from a file with line numbers."""
        workspace: Path = ctx.deps.workspace
        resolved = _safe_resolve(workspace, path)
        if not resolved.is_file():
            return f"Error: {path} is not a file"
        lines = resolved.read_text(encoding="utf-8").splitlines()
        end = min(offset + limit, len(lines))
        numbered = [f"{i + 1}\t{lines[i]}" for i in range(offset, end)]
        header = f"[{path}] lines {offset + 1}-{end} of {len(lines)}"
        return f"{header}\n" + "\n".join(numbered)

    @agent.tool
    async def grep(ctx: RunContext[Any], pattern: str, path: str = ".") -> str:
        """Search for a regex pattern in files. Returns matching lines as file:line:content."""
        workspace: Path = ctx.deps.workspace
        resolved = _safe_resolve(workspace, path)
        try:
            regex = re.compile(pattern, re.IGNORECASE)
        except re.error as e:
            return f"Invalid regex: {e}"

        matches: list[str] = []
        targets = [resolved] if resolved.is_file() else sorted(resolved.rglob("*"))
        for fp in targets:
            if not fp.is_file():
                continue
            rel = fp.relative_to(workspace)
            text = fp.read_text(encoding="utf-8", errors="replace")
            for i, line in enumerate(text.splitlines(), 1):
                if regex.search(line):
                    matches.append(f"{rel}:{i}: {line}")
                    if len(matches) >= 100:
                        matches.append("... (truncated at 100 matches)")
                        return "\n".join(matches)
        return "\n".join(matches) if matches else "No matches found."

    @agent.tool
    async def list_files(ctx: RunContext[Any], path: str = ".") -> str:
        """List files and directories in the workspace."""
        workspace: Path = ctx.deps.workspace
        resolved = _safe_resolve(workspace, path)
        if not resolved.is_dir():
            return f"Error: {path} is not a directory"
        entries: list[str] = []
        for entry in sorted(resolved.iterdir()):
            rel = entry.relative_to(workspace)
            suffix = "/" if entry.is_dir() else f"  ({entry.stat().st_size} bytes)"
            entries.append(f"{rel}{suffix}")
        return "\n".join(entries) if entries else "(empty directory)"

    @agent.tool
    async def file_info(ctx: RunContext[Any], path: str) -> str:
        """Return file statistics: line count, char count, estimated tokens."""
        workspace: Path = ctx.deps.workspace
        resolved = _safe_resolve(workspace, path)
        if not resolved.is_file():
            return f"Error: {path} is not a file"
        text = resolved.read_text(encoding="utf-8")
        lines = text.count("\n") + 1
        chars = len(text)
        est_tokens = chars // 4
        return f"path={path} lines={lines} chars={chars} estimated_tokens={est_tokens}"

    if allow_write:

        @agent.tool
        async def write_file(ctx: RunContext[Any], path: str, content: str) -> str:
            """Write content to a file (creates parent directories if needed)."""
            workspace: Path = ctx.deps.workspace
            resolved = _safe_resolve(workspace, path)
            resolved.parent.mkdir(parents=True, exist_ok=True)
            resolved.write_text(content, encoding="utf-8")
            return f"Written {len(content)} chars to {path}"


# ---------------------------------------------------------------------------
# Extraction Agent
# ---------------------------------------------------------------------------


@dataclass
class DreamDeps:
    transcript_id: int
    workspace: Path
    extracted_memories: list[MemoryItem] = field(default_factory=list)
    session_id: str = ""
    project: str | None = None
    token_count: int | None = None
    created_at: datetime | None = None


def _load_extraction_prompt() -> str:
    return (_PROMPTS_DIR / "light_dream_extract.md").read_text(encoding="utf-8")


_extraction_agent: Agent[DreamDeps, ExtractionSummary] | None = None


def _get_extraction_agent() -> Agent[DreamDeps, ExtractionSummary]:
    global _extraction_agent
    if _extraction_agent is not None:
        return _extraction_agent

    agent: Agent[DreamDeps, ExtractionSummary] = Agent(
        _build_model(),
        deps_type=DreamDeps,
        output_type=ExtractionSummary,
        instructions=_load_extraction_prompt(),
        retries=2,
        output_retries=3,
        history_processors=[compact_history],
    )

    _register_file_tools(agent, allow_write=False)

    @agent.tool
    async def store_memory(
        ctx: RunContext[DreamDeps],
        category: str,
        content: str,
        vault_target: str,
        source_date: str,
        reasoning: str | None = None,
    ) -> str:
        """Store an extracted memory. Call for each insight found."""
        if category not in MEMORY_CATEGORIES:
            return f"Invalid category '{category}'. Must be one of: {', '.join(MEMORY_CATEGORIES)}"
        if vault_target not in ALLOWED_VAULT_TARGETS:
            valid = ", ".join(ALLOWED_VAULT_TARGETS)
            return f"Invalid vault_target '{vault_target}'. Use: {valid}"
        item = MemoryItem(
            content=content,
            reasoning=reasoning,
            vault_target=vault_target,  # type: ignore[arg-type]
            source_date=source_date,
        )
        ctx.deps.extracted_memories.append(item)
        return f"Stored {category}: {content[:80]}..."

    _extraction_agent = agent
    return _extraction_agent


EXTRACTION_LIMITS = UsageLimits(total_tokens_limit=1_500_000, tool_calls_limit=300)


async def run_dream_extraction(
    deps: DreamDeps,
) -> tuple[ExtractionSummary, RunUsage, int]:
    agent = _get_extraction_agent()
    result = await agent.run(
        "Extract memories from the transcript using the available tools. "
        "Call store_memory() for each insight you find as you read.",
        deps=deps,
        usage_limits=EXTRACTION_LIMITS,
    )
    return result.output, result.usage(), _count_tool_calls(result.all_messages())


# ---------------------------------------------------------------------------
# Merge Agent
# ---------------------------------------------------------------------------


@dataclass
class MergeDeps:
    workspace: Path
    extracted_memories: list[MemoryItem] = field(default_factory=list)
    source_date: date = field(default_factory=date.today)
    session_id: str = ""
    summary: str = ""


def _load_merge_prompt() -> str:
    return (_PROMPTS_DIR / "merge_agent.md").read_text(encoding="utf-8")


_merge_agent: Agent[MergeDeps, MergeResult] | None = None


def _get_merge_agent() -> Agent[MergeDeps, MergeResult]:
    global _merge_agent
    if _merge_agent is not None:
        return _merge_agent

    agent: Agent[MergeDeps, MergeResult] = Agent(
        _build_model(),
        deps_type=MergeDeps,
        output_type=MergeResult,
        instructions=_load_merge_prompt(),
        retries=2,
        output_retries=3,
        history_processors=[compact_history],
    )

    _register_file_tools(agent, allow_write=True)

    @agent.tool
    async def get_extracted_memories(ctx: RunContext[MergeDeps]) -> str:
        """Return all extracted memories from the extraction agent as formatted text."""
        memories = ctx.deps.extracted_memories
        if not memories:
            return "No memories to merge."
        lines: list[str] = []
        for i, m in enumerate(memories, 1):
            reason = f" (reason: {m.reasoning})" if m.reasoning else ""
            lines.append(f"[{i}] [{m.vault_target}] {m.source_date}: {m.content}{reason}")
        return "\n".join(lines)

    @agent.tool
    async def memu_search(ctx: RunContext[MergeDeps], query: str, limit: int = 10) -> str:
        """Search MemU for semantically similar memories. Use to check for duplicates."""
        from app.services.memu_client import memu_retrieve

        try:
            result = await memu_retrieve(query)
            items = result.get("results", result.get("memories", []))
            if not items:
                return "No matching memories found in MemU."
            lines = [
                f"[{i}] {item.get('content', str(item))}"
                for i, item in enumerate(items[:limit], 1)
            ]
            return "\n".join(lines)
        except Exception as exc:
            return f"MemU search unavailable: {exc}"

    @agent.tool
    async def memu_add(ctx: RunContext[MergeDeps], content: str, category: str) -> str:
        """Store a memory to MemU for semantic indexing."""
        from app.services.memu_client import memu_memorize

        try:
            await memu_memorize([{"role": "user", "content": content}])
            return f"Indexed to MemU: {content[:80]}..."
        except Exception as exc:
            return f"MemU add failed: {exc}"

    _merge_agent = agent
    return _merge_agent


MERGE_LIMITS = UsageLimits(total_tokens_limit=1_500_000, tool_calls_limit=300)


async def run_merge(deps: MergeDeps) -> tuple[MergeResult, RunUsage, int]:
    agent = _get_merge_agent()
    result = await agent.run(
        "Merge the extracted memories into the ai-memory repository. "
        "Call get_extracted_memories() first to see what needs to be merged.",
        deps=deps,
        usage_limits=MERGE_LIMITS,
    )
    return result.output, result.usage(), _count_tool_calls(result.all_messages())


# ---------------------------------------------------------------------------
# Deep Dream Agent (kept for now — uses ConsolidationOutput)
# ---------------------------------------------------------------------------

from app.services.dream_models import ConsolidationOutput  # noqa: E402


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
        history_processors=[compact_history],
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
    return result.output, result.usage(), _count_tool_calls(result.all_messages())


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


# Ensure temp dir parent exists
os.makedirs("/tmp/jarvis-dreams", exist_ok=True)
