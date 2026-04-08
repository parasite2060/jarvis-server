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
    LightSleepOutput,
    MemoryItem,
    RecordResult,
    REMSleepOutput,
    ScoredCandidate,
    SessionLogEntry,
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
    # Session log sections (populated by store tools)
    session_context: str = ""
    session_key_exchanges: list[str] = field(default_factory=list)
    session_decisions: list[str] = field(default_factory=list)
    session_lessons: list[str] = field(default_factory=list)
    session_action_items: list[str] = field(default_factory=list)
    session_concepts: list[dict[str, str]] = field(default_factory=list)
    session_connections: list[dict[str, str]] = field(default_factory=list)


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
    async def store_context(ctx: RunContext[DreamDeps], content: str) -> str:
        """Store the session context — a brief description of the session (1-3 sentences)."""
        ctx.deps.session_context = content
        return f"Context stored: {content[:80]}..."

    @agent.tool
    async def store_decision(
        ctx: RunContext[DreamDeps], decision: str, reasoning: str
    ) -> str:
        """Store a decision made during the session. Format: what was decided and why."""
        entry = f"{decision} — {reasoning}"
        ctx.deps.session_decisions.append(entry)
        # Also store as MemoryItem for knowledge base
        ctx.deps.extracted_memories.append(
            MemoryItem(
                content=decision,
                reasoning=reasoning,
                vault_target="decisions",
                source_date=date.today().isoformat(),
            )
        )
        return f"Decision stored: {entry[:80]}..."

    @agent.tool
    async def store_lesson(ctx: RunContext[DreamDeps], lesson: str) -> str:
        """Store a lesson learned — what went well, what could improve, or a surprising finding."""
        ctx.deps.session_lessons.append(lesson)
        return f"Lesson stored: {lesson[:80]}..."

    @agent.tool
    async def store_action_item(ctx: RunContext[DreamDeps], action: str) -> str:
        """Store an action item or follow-up task identified during the session."""
        ctx.deps.session_action_items.append(action)
        return f"Action item stored: {action[:80]}..."

    @agent.tool
    async def store_key_exchange(ctx: RunContext[DreamDeps], exchange: str) -> str:
        """Store a key exchange — a notable question/answer or dialogue moment worth remembering."""
        ctx.deps.session_key_exchanges.append(exchange)
        return f"Key exchange stored: {exchange[:80]}..."

    @agent.tool
    async def store_concept(
        ctx: RunContext[DreamDeps], name: str, description: str
    ) -> str:
        """Store a concept discussed in the session. Creates a knowledge base entry."""
        ctx.deps.session_concepts.append({"name": name, "description": description})
        ctx.deps.extracted_memories.append(
            MemoryItem(
                content=f"{name}: {description}",
                reasoning=None,
                vault_target="concepts",
                source_date=date.today().isoformat(),
            )
        )
        return f"Concept stored: {name}"

    @agent.tool
    async def store_connection(
        ctx: RunContext[DreamDeps],
        concept_a: str,
        concept_b: str,
        relationship: str,
    ) -> str:
        """Store a connection between two concepts discussed in the session."""
        ctx.deps.session_connections.append(
            {
                "concept_a": concept_a,
                "concept_b": concept_b,
                "relationship": relationship,
            }
        )
        ctx.deps.extracted_memories.append(
            MemoryItem(
                content=f"{concept_a} <-> {concept_b}: {relationship}",
                reasoning=None,
                vault_target="connections",
                source_date=date.today().isoformat(),
            )
        )
        return f"Connection stored: {concept_a} <-> {concept_b}"

    @agent.tool
    async def store_memory(
        ctx: RunContext[DreamDeps],
        category: str,
        content: str,
        vault_target: str,
        source_date: str,
        reasoning: str | None = None,
    ) -> str:
        """Store a general memory (pattern, preference, fact, correction).

        Use store_decision/store_lesson/store_action_item for those types instead.
        """
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

MIN_USER_MESSAGES = 3
CONTEXT_RETRY_LIMIT = 3


def _count_user_messages(workspace: Path) -> int:
    transcript = workspace / "transcript.txt"
    if not transcript.is_file():
        return 0
    text = transcript.read_text(encoding="utf-8")
    return sum(1 for line in text.splitlines() if line.lstrip().startswith("User:"))


async def run_dream_extraction(
    deps: DreamDeps,
) -> tuple[ExtractionSummary, RunUsage, int]:
    # Skip very short sessions
    user_msg_count = _count_user_messages(deps.workspace)
    if user_msg_count < MIN_USER_MESSAGES:
        log.info(
            "dream_extraction.skipped.short_session",
            user_messages=user_msg_count,
        )
        return (
            ExtractionSummary(no_extract=True, summary="Session too short"),
            RunUsage(),
            0,
        )

    agent = _get_extraction_agent()
    result = await agent.run(
        "Extract session insights from the transcript using the available tools. "
        "Use store_context(), store_key_exchange(), store_decision(), store_lesson(), "
        "store_action_item(), store_concept(), store_connection() for structured "
        "session log. Use store_memory() only for general patterns, preferences, "
        "facts, or corrections.",
        deps=deps,
        usage_limits=EXTRACTION_LIMITS,
    )

    # Context is required — retry if agent forgot to store it
    for attempt in range(CONTEXT_RETRY_LIMIT):
        if deps.session_context:
            break
        log.warning(
            "dream_extraction.context_missing.retry",
            attempt=attempt + 1,
        )
        result = await agent.run(
            "You forgot to call store_context(). "
            "Read the transcript and call store_context() with a brief "
            "description of what this session was about (1-3 sentences). "
            "This is required.",
            deps=deps,
            message_history=result.all_messages(),
            usage_limits=EXTRACTION_LIMITS,
        )

    if not deps.session_context:
        log.error("dream_extraction.context_missing.gave_up")

    # Assemble session log from stored data
    output = result.output
    output.session_log = SessionLogEntry(
        context=deps.session_context,
        key_exchanges=deps.session_key_exchanges,
        decisions_made=deps.session_decisions,
        lessons_learned=deps.session_lessons,
        action_items=deps.session_action_items,
        concepts=deps.session_concepts,
        connections=deps.session_connections,
    )
    return output, result.usage(), _count_tool_calls(result.all_messages())


# ---------------------------------------------------------------------------
# Record Agent
# ---------------------------------------------------------------------------


@dataclass
class RecordDeps:
    workspace: Path
    extracted_memories: list[MemoryItem] = field(default_factory=list)
    source_date: date = field(default_factory=date.today)
    session_id: str = ""
    summary: str = ""
    session_log: SessionLogEntry = field(default_factory=SessionLogEntry)


def _load_record_prompt() -> str:
    return (_PROMPTS_DIR / "record_agent.md").read_text(encoding="utf-8")


_record_agent: Agent[RecordDeps, RecordResult] | None = None


def _get_record_agent() -> Agent[RecordDeps, RecordResult]:
    global _record_agent
    if _record_agent is not None:
        return _record_agent

    agent: Agent[RecordDeps, RecordResult] = Agent(
        _build_model(),
        deps_type=RecordDeps,
        output_type=RecordResult,
        instructions=_load_record_prompt(),
        retries=2,
        output_retries=3,
        history_processors=[compact_history],
    )

    _register_file_tools(agent, allow_write=False)

    @agent.tool
    async def write_file(ctx: RunContext[RecordDeps], path: str, content: str) -> str:
        """Write content to a file. Only dailys/ paths are allowed."""
        if not path.startswith("dailys/"):
            return (
                "Error: Record agent can only write to dailys/. "
                "Knowledge writes are handled by deep dream."
            )
        workspace: Path = ctx.deps.workspace
        resolved = _safe_resolve(workspace, path)
        resolved.parent.mkdir(parents=True, exist_ok=True)
        resolved.write_text(content, encoding="utf-8")
        return f"Written {len(content)} chars to {path}"

    @agent.tool
    async def get_extracted_memories(ctx: RunContext[RecordDeps]) -> str:
        """Return all extracted memories from the extraction agent as formatted text."""
        memories = ctx.deps.extracted_memories
        if not memories:
            return "No memories to record."
        lines: list[str] = []
        for i, m in enumerate(memories, 1):
            reason = f" (reason: {m.reasoning})" if m.reasoning else ""
            lines.append(f"[{i}] [{m.vault_target}] {m.source_date}: {m.content}{reason}")
        return "\n".join(lines)

    @agent.tool
    async def get_session_log(ctx: RunContext[RecordDeps]) -> str:
        """Return the structured session log for daily log recording."""
        parts: list[str] = []
        parts.append(f"Summary: {ctx.deps.summary}")
        sl = ctx.deps.session_log
        if sl.context:
            parts.append(f"Context: {sl.context}")
        if sl.decisions_made:
            parts.append("Decisions Made:")
            for item in sl.decisions_made:
                parts.append(f"  - {item}")
        if sl.key_exchanges:
            parts.append("Key Exchanges:")
            for item in sl.key_exchanges:
                parts.append(f"  - {item}")
        if sl.lessons_learned:
            parts.append("Lessons Learned:")
            for item in sl.lessons_learned:
                parts.append(f"  - {item}")
        if sl.action_items:
            parts.append("Action Items:")
            for item in sl.action_items:
                parts.append(f"  - {item}")
        if sl.concepts:
            parts.append("Concepts:")
            for item in sl.concepts:
                parts.append(f"  - {item.get('name', '')}: {item.get('description', '')}")
        if sl.connections:
            parts.append("Connections:")
            for item in sl.connections:
                parts.append(
                    f"  - {item.get('concept_a', '')} <-> {item.get('concept_b', '')}: "
                    f"{item.get('relationship', '')}"
                )
        return "\n".join(parts) if parts else "No session log available."

    @agent.tool
    async def update_reinforcement(ctx: RunContext[RecordDeps], file_path: str) -> str:
        """Increment reinforcement_count and update last_reinforced in frontmatter."""
        workspace: Path = ctx.deps.workspace
        resolved = _safe_resolve(workspace, file_path)
        if not resolved.is_file():
            return f"Error: {file_path} is not a file"
        text = resolved.read_text(encoding="utf-8")
        fm_match = re.match(r"^---\n(.*?\n)---\n", text, re.DOTALL)
        if not fm_match:
            return f"Error: {file_path} has no YAML frontmatter"
        frontmatter = fm_match.group(1)
        body = text[fm_match.end():]

        count_match = re.search(r"^reinforcement_count:\s*(\d+)", frontmatter, re.MULTILINE)
        if count_match:
            old_count = int(count_match.group(1))
            frontmatter = frontmatter.replace(
                count_match.group(0), f"reinforcement_count: {old_count + 1}"
            )
        else:
            frontmatter += "reinforcement_count: 1\n"

        today_str = date.today().isoformat()
        reinforced_match = re.search(r"^last_reinforced:\s*.*$", frontmatter, re.MULTILINE)
        if reinforced_match:
            frontmatter = frontmatter.replace(
                reinforced_match.group(0), f"last_reinforced: {today_str}"
            )
        else:
            frontmatter += f"last_reinforced: {today_str}\n"

        resolved.write_text(f"---\n{frontmatter}---\n{body}", encoding="utf-8")
        return f"Reinforcement updated for {file_path}"

    @agent.tool
    async def flag_contradiction(
        ctx: RunContext[RecordDeps], file_path: str, reason: str
    ) -> str:
        """Flag a contradiction in a vault file's YAML frontmatter for deep dream review."""
        workspace: Path = ctx.deps.workspace
        resolved = _safe_resolve(workspace, file_path)
        if not resolved.is_file():
            return f"Error: {file_path} is not a file"
        text = resolved.read_text(encoding="utf-8")
        fm_match = re.match(r"^---\n(.*?\n)---\n", text, re.DOTALL)
        if not fm_match:
            return f"Error: {file_path} has no YAML frontmatter"
        frontmatter = fm_match.group(1)
        body = text[fm_match.end():]

        contradiction_match = re.search(r"^has_contradiction:\s*.*$", frontmatter, re.MULTILINE)
        if contradiction_match:
            frontmatter = frontmatter.replace(
                contradiction_match.group(0), "has_contradiction: true"
            )
        else:
            frontmatter += "has_contradiction: true\n"

        reason_match = re.search(r"^contradiction_reason:\s*.*$", frontmatter, re.MULTILINE)
        if reason_match:
            frontmatter = frontmatter.replace(
                reason_match.group(0), f"contradiction_reason: {reason}"
            )
        else:
            frontmatter += f"contradiction_reason: {reason}\n"

        resolved.write_text(f"---\n{frontmatter}---\n{body}", encoding="utf-8")
        return f"Contradiction flagged for {file_path}: {reason}"

    @agent.tool
    async def memu_search(ctx: RunContext[RecordDeps], query: str, limit: int = 10) -> str:
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
    async def memu_add(ctx: RunContext[RecordDeps], content: str, category: str) -> str:
        """Store a memory to MemU for semantic indexing."""
        from app.services.memu_client import memu_memorize

        try:
            await memu_memorize([{"role": "user", "content": content}])
            return f"Indexed to MemU: {content[:80]}..."
        except Exception as exc:
            return f"MemU add failed: {exc}"

    _record_agent = agent
    return _record_agent


RECORD_LIMITS = UsageLimits(total_tokens_limit=1_500_000, tool_calls_limit=300)


async def run_record(deps: RecordDeps) -> tuple[RecordResult, RunUsage, int]:
    agent = _get_record_agent()
    result = await agent.run(
        "Record the session to the daily log and track reinforcement signals. "
        "Call get_session_log() first.",
        deps=deps,
        usage_limits=RECORD_LIMITS,
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
    phase1_summary: str = ""
    phase2_summary: str = ""


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

    @agent.tool
    async def read_phase1_candidates(ctx: RunContext[DeepDreamDeps]) -> str:
        """Return Phase 1 scored candidates summary (if available)."""
        return ctx.deps.phase1_summary or "No Phase 1 data available."

    @agent.tool
    async def read_phase2_analysis(ctx: RunContext[DeepDreamDeps]) -> str:
        """Return Phase 2 themes, connections, and promotion candidates (if available)."""
        return ctx.deps.phase2_summary or "No Phase 2 data available."

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
            for folder in (
                "decisions", "projects", "patterns", "templates",
                "concepts", "connections", "lessons",
            )
        },
    }


# ---------------------------------------------------------------------------
# Phase 1: Light Sleep Agent
# ---------------------------------------------------------------------------


def _load_phase1_prompt() -> str:
    return (_PROMPTS_DIR / "deep_dream_phase1_light_sleep.md").read_text(encoding="utf-8")


_phase1_agent: Agent[DeepDreamDeps, LightSleepOutput] | None = None


def _get_phase1_agent() -> Agent[DeepDreamDeps, LightSleepOutput]:
    global _phase1_agent
    if _phase1_agent is not None:
        return _phase1_agent

    agent: Agent[DeepDreamDeps, LightSleepOutput] = Agent(
        _build_model(),
        deps_type=DeepDreamDeps,
        output_type=LightSleepOutput,
        instructions=_load_phase1_prompt(),
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

    _phase1_agent = agent
    return _phase1_agent


PHASE1_USAGE_LIMITS = UsageLimits(total_tokens_limit=50_000, tool_calls_limit=10)


async def run_phase1_light_sleep(
    deps: DeepDreamDeps,
) -> tuple[LightSleepOutput, RunUsage, int]:
    agent = _get_phase1_agent()
    result = await agent.run(
        "Inventory, deduplicate, and score all memories using the available tools. "
        "Read all inputs via tools before producing output.",
        deps=deps,
        usage_limits=PHASE1_USAGE_LIMITS,
    )
    return result.output, result.usage(), _count_tool_calls(result.all_messages())


# ---------------------------------------------------------------------------
# Phase 2: REM Sleep Agent
# ---------------------------------------------------------------------------


@dataclass
class Phase2Deps:
    source_date: date
    daily_logs: dict[str, str]  # date string → content
    vault_indexes: dict[str, str]  # folder name → _index.md content
    phase1_candidates: list[ScoredCandidate]


def _load_phase2_prompt() -> str:
    return (_PROMPTS_DIR / "deep_dream_phase2_rem_sleep.md").read_text(encoding="utf-8")


_phase2_agent: Agent[Phase2Deps, REMSleepOutput] | None = None


def _get_phase2_agent() -> Agent[Phase2Deps, REMSleepOutput]:
    global _phase2_agent
    if _phase2_agent is not None:
        return _phase2_agent

    agent: Agent[Phase2Deps, REMSleepOutput] = Agent(
        _build_model(),
        deps_type=Phase2Deps,
        output_type=REMSleepOutput,
        instructions=_load_phase2_prompt(),
        retries=2,
        output_retries=3,
        history_processors=[compact_history],
    )

    @agent.tool
    async def read_daily_log(ctx: RunContext[Phase2Deps], date_str: str) -> str:
        """Return daily log content for a specific date (YYYY-MM-DD)."""
        content = ctx.deps.daily_logs.get(date_str)
        if content is None:
            return f"No daily log found for {date_str}"
        return content

    @agent.tool
    async def read_vault_index(ctx: RunContext[Phase2Deps], folder: str) -> str:
        """Return _index.md content for a vault folder."""
        content = ctx.deps.vault_indexes.get(folder)
        if content is None:
            return f"No _index.md found for folder '{folder}'"
        return content

    @agent.tool
    async def get_phase1_candidates(ctx: RunContext[Phase2Deps]) -> str:
        """Return formatted Phase 1 scored candidates."""
        candidates = ctx.deps.phase1_candidates
        if not candidates:
            return "No Phase 1 candidates available."
        lines: list[str] = []
        for i, c in enumerate(candidates, 1):
            flag = " [CONTRADICTION]" if c.contradiction_flag else ""
            sessions = ", ".join(c.source_sessions) if c.source_sessions else "n/a"
            lines.append(
                f"[{i}] ({c.category}) {c.content} "
                f"[reinforced={c.reinforcement_count}, sessions={sessions}]{flag}"
            )
        return "\n".join(lines)

    _phase2_agent = agent
    return _phase2_agent


PHASE2_USAGE_LIMITS = UsageLimits(total_tokens_limit=80_000, tool_calls_limit=20)


async def run_phase2_rem_sleep(
    deps: Phase2Deps,
) -> tuple[REMSleepOutput, RunUsage, int]:
    agent = _get_phase2_agent()
    result = await agent.run(
        "Analyze cross-session patterns using the available tools. "
        "Read daily logs, vault indexes, and Phase 1 candidates before producing output.",
        deps=deps,
        usage_limits=PHASE2_USAGE_LIMITS,
    )
    return result.output, result.usage(), _count_tool_calls(result.all_messages())


# Ensure temp dir parent exists
os.makedirs("/tmp/jarvis-dreams", exist_ok=True)
