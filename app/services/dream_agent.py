from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from fnmatch import fnmatch
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
    ALLOWED_RELATIONSHIP_TYPES,
    ALLOWED_VAULT_TARGETS,
    ExtractionSummary,
    LightSleepOutput,
    MemoryItem,
    RecordResult,
    REMSleepOutput,
    ScoredCandidate,
    SessionLogEntry,
    WeeklyReviewOutput,
)
from app.services.memory_files import read_vault_file as _read_vault_file

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
# Vault path resolution (used by base tools)
# ---------------------------------------------------------------------------


def _vault_root() -> Path:
    return Path(settings.jarvis_memory_path)


def _resolve_vault_path(relative: str) -> Path | None:
    root = _vault_root()
    resolved = (root / relative).resolve()
    if not resolved.is_relative_to(root.resolve()):
        return None  # path traversal blocked
    return resolved


# ---------------------------------------------------------------------------
# Standardized base tools (all agents get vault read + MemU)
# ---------------------------------------------------------------------------


def _register_base_tools(agent: Agent[Any, Any]) -> None:
    """Register standard read-only tools on any agent.
    All agents get readonly access to vault files + MemU.
    Paths resolve relative to settings.jarvis_memory_path (vault root)."""

    @agent.tool
    async def read_file(ctx: RunContext[Any], path: str, offset: int = 0, limit: int = 0) -> str:
        """Read a vault file. Full content if limit=0, or line range with offset+limit."""
        resolved = _resolve_vault_path(path)
        if resolved is None or not resolved.is_file():
            return f"File not found: {path}"
        text = resolved.read_text(encoding="utf-8")
        if limit > 0:
            lines = text.splitlines()
            end = min(offset + limit, len(lines))
            numbered = [f"{i + 1}\t{lines[i]}" for i in range(offset, end)]
            header = f"[{path}] lines {offset + 1}-{end} of {len(lines)}"
            return f"{header}\n" + "\n".join(numbered)
        return text

    @agent.tool
    async def grep(ctx: RunContext[Any], pattern: str, path: str = ".") -> str:
        """Search vault files for a regex pattern. Recursive through subdirectories."""
        root = _vault_root()
        resolved = _resolve_vault_path(path)
        if resolved is None:
            return f"Invalid path: {path}"
        try:
            regex = re.compile(pattern, re.IGNORECASE)
        except re.error as e:
            return f"Invalid regex: {e}"
        matches: list[str] = []
        targets = [resolved] if resolved.is_file() else sorted(resolved.rglob("*"))
        for fp in targets:
            if not fp.is_file() or fp.name.startswith("."):
                continue
            try:
                rel = fp.relative_to(root)
                text = fp.read_text(encoding="utf-8", errors="replace")
                for i, line in enumerate(text.splitlines(), 1):
                    if regex.search(line):
                        matches.append(f"{rel}:{i}: {line}")
                        if len(matches) >= 100:
                            matches.append("... (truncated at 100)")
                            return "\n".join(matches)
            except (UnicodeDecodeError, OSError):
                continue
        return "\n".join(matches) if matches else "No matches found."

    @agent.tool
    async def list_files(ctx: RunContext[Any], path: str = ".") -> str:
        """List files and directories in the vault. Shows subdirectory contents."""
        resolved = _resolve_vault_path(path)
        if resolved is None or not resolved.is_dir():
            return f"Not a directory: {path}"
        root = _vault_root()
        entries: list[str] = []
        for entry in sorted(resolved.iterdir()):
            if entry.name.startswith("."):
                continue
            rel = entry.relative_to(root)
            suffix = "/" if entry.is_dir() else f"  ({entry.stat().st_size} bytes)"
            entries.append(f"{rel}{suffix}")
        return "\n".join(entries) if entries else "(empty directory)"

    @agent.tool
    async def file_info(ctx: RunContext[Any], path: str) -> str:
        """Return file statistics: line count, char count, estimated tokens."""
        resolved = _resolve_vault_path(path)
        if resolved is None or not resolved.is_file():
            return f"File not found: {path}"
        text = resolved.read_text(encoding="utf-8")
        lines = text.count("\n") + 1
        chars = len(text)
        est_tokens = chars // 4
        return f"path={path} lines={lines} chars={chars} estimated_tokens={est_tokens}"

    @agent.tool
    async def read_frontmatter(ctx: RunContext[Any], path: str) -> str:
        """Read only YAML frontmatter of a vault file.
        Returns metadata (type, status, reinforcement_count, confidence, etc.)."""
        resolved = _resolve_vault_path(path)
        if resolved is None or not resolved.is_file():
            return f"File not found: {path}"
        text = resolved.read_text(encoding="utf-8")
        if not text.startswith("---"):
            return f"No frontmatter in {path}"
        end = text.find("---", 3)
        if end == -1:
            return f"Malformed frontmatter in {path}"
        return text[3:end].strip()

    @agent.tool
    async def memu_search(ctx: RunContext[Any], query: str, limit: int = 5) -> str:
        """Semantic search across vault knowledge via MemU.
        Returns the most similar entries to the query."""
        from app.services.memu_client import memu_retrieve

        try:
            result = await memu_retrieve(query)
            items = result.get("results", result.get("memories", []))
            if not items:
                return "No similar entries found."
            lines = [
                f"[{i}] {item.get('content', str(item))}" for i, item in enumerate(items[:limit], 1)
            ]
            return "\n".join(lines)
        except Exception as exc:
            return f"MemU search unavailable: {exc}"

    @agent.tool
    async def memu_categories(ctx: RunContext[Any]) -> str:
        """List available MemU memory categories."""
        from app.services.memu_client import memu_retrieve

        try:
            result = await memu_retrieve("list categories")
            categories = result.get("categories", [])
            if categories:
                return "\n".join(f"- {c}" for c in categories)
            return (
                "Categories: decisions, preferences, patterns, "
                "corrections, facts, concepts, connections, lessons"
            )
        except Exception:
            return (
                "Categories: decisions, preferences, patterns, "
                "corrections, facts, concepts, connections, lessons"
            )


# ---------------------------------------------------------------------------
# Extraction Agent
# ---------------------------------------------------------------------------


@dataclass
class DreamDeps:
    """Extraction-agent scratch state.

    `memories` accumulates MemoryItem objects from the store_* tools during the
    agent run. At end-of-run it is assigned to ExtractionSummary.session_log.memories
    — memories are a property of SessionLogEntry, not a standalone entity.
    """

    transcript_id: int
    workspace: Path
    memories: list[MemoryItem] = field(default_factory=list)
    session_id: str = ""
    project: str | None = None
    token_count: int | None = None
    created_at: datetime | None = None
    transcript_file: str = ""
    # Session log sections (populated by store tools; collapsed into SessionLogEntry at end-of-run)
    session_context: str = ""
    session_key_exchanges: list[str] = field(default_factory=list)
    session_decisions: list[str] = field(default_factory=list)
    session_lessons: list[str] = field(default_factory=list)
    session_failed_lessons: list[dict[str, str]] = field(default_factory=list)
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

    _register_base_tools(agent)  # vault access + MemU

    @agent.tool
    async def store_context(ctx: RunContext[DreamDeps], content: str) -> str:
        """Store the session context — a brief description of the session (1-3 sentences)."""
        ctx.deps.session_context = content
        return f"Context stored: {content[:80]}..."

    @agent.tool
    async def store_decision(ctx: RunContext[DreamDeps], decision: str, reasoning: str) -> str:
        """Store a decision made during the session. Format: what was decided and why."""
        entry = f"{decision} — {reasoning}"
        ctx.deps.session_decisions.append(entry)
        # Also store as MemoryItem for knowledge base
        ctx.deps.memories.append(
            MemoryItem(
                content=decision,
                reasoning=reasoning,
                vault_target="decisions",
                source_date=date.today().isoformat(),
            )
        )
        return f"Decision stored: {entry[:80]}..."

    @agent.tool
    async def store_lesson(
        ctx: RunContext[DreamDeps],
        lesson: str,
        outcome: str | None = None,
        failure_reason: str | None = None,
    ) -> str:
        """Store a lesson learned — what went well, what could improve, or a surprising finding.

        If the lesson is about something that FAILED or DIDN'T WORK, use:
        - outcome='failed' and failure_reason='why it failed'
        Valid outcome values: success, failed, mixed. Optional for non-failed lessons.
        """
        ctx.deps.session_lessons.append(lesson)
        if outcome and outcome in ("success", "failed", "mixed") and outcome == "failed":
            entry = {"lesson": lesson, "outcome": outcome, "failure_reason": failure_reason or ""}
            ctx.deps.session_failed_lessons.append(entry)
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
    async def store_concept(ctx: RunContext[DreamDeps], name: str, description: str) -> str:
        """Store a concept discussed in the session. Creates a knowledge base entry."""
        ctx.deps.session_concepts.append({"name": name, "description": description})
        ctx.deps.memories.append(
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
        relationship_type: str = "supports",
    ) -> str:
        """Store a connection between two concepts discussed in the session.

        Optional relationship_type classifies the edge:
        extends, contradicts, supports, inspired_by, supersedes, derived_from, addresses_gap.
        Defaults to 'supports'.
        """
        if relationship_type not in ALLOWED_RELATIONSHIP_TYPES:
            valid = ", ".join(ALLOWED_RELATIONSHIP_TYPES)
            return f"Invalid relationship_type '{relationship_type}'. Must be one of: {valid}"
        ctx.deps.session_connections.append(
            {
                "concept_a": concept_a,
                "concept_b": concept_b,
                "relationship": relationship,
                "relationship_type": relationship_type,
            }
        )
        ctx.deps.memories.append(
            MemoryItem(
                content=f"{concept_a} <-> {concept_b}: {relationship} ({relationship_type})",
                reasoning=None,
                vault_target="connections",
                source_date=date.today().isoformat(),
            )
        )
        return f"Connection stored: {concept_a} <-> {concept_b} [{relationship_type}]"

    @agent.tool
    async def store_session_memory(
        ctx: RunContext[DreamDeps],
        category: str,
        content: str,
        vault_target: str,
        source_date: str,
        reasoning: str | None = None,
    ) -> str:
        """Store a session memory — general observations, preferences,
        facts, corrections that don't fit other store tools.
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
        ctx.deps.memories.append(item)
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
    return sum(
        1
        for line in text.splitlines()
        if "User:" in line and (line.lstrip().startswith("User:") or line.lstrip().startswith("["))
    )


async def run_dream_extraction(
    deps: DreamDeps,
) -> tuple[ExtractionSummary, RunUsage, int, list[Any]]:
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
            [],
        )

    # Read MEMORY.md from vault for duplicate-aware extraction
    memory_md = await _read_vault_file("MEMORY.md") or "(empty)"

    sections = [
        "Extract session insights from the transcript.",
        "Use store_* tools for structured session log.",
        "Use store_session_memory() only for general patterns, preferences, facts, corrections.",
        "",
        "## Session Metadata",
        f"Session ID: {deps.session_id}",
        f"Project: {deps.project or 'unknown'}",
        f"Token count: {deps.token_count or 'unknown'}",
        f"Transcript lines: {user_msg_count} user messages",
        f"Transcript file: {deps.transcript_file}",
        "",
        "## Current MEMORY.md (what the vault already knows)",
        memory_md,
        "",
        "Skip extracting insights that are already in Strong Patterns above.",
        "Focus on NEW decisions, lessons, and concepts not yet captured.",
    ]

    agent = _get_extraction_agent()
    result = await agent.run(
        "\n".join(sections),
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

    # Assemble session log from stored data.
    # memories are a property of SessionLogEntry — assigned directly from deps.memories
    # (structured MemoryItem objects, not display strings).
    output = result.output
    output.session_log = SessionLogEntry(
        context=deps.session_context,
        key_exchanges=deps.session_key_exchanges,
        decisions_made=deps.session_decisions,
        lessons_learned=deps.session_lessons,
        failed_lessons=deps.session_failed_lessons,
        action_items=deps.session_action_items,
        concepts=deps.session_concepts,
        connections=deps.session_connections,
        memories=deps.memories,
    )
    return output, result.usage(), _count_tool_calls(result.all_messages()), result.all_messages()


# ---------------------------------------------------------------------------
# Record Agent
# ---------------------------------------------------------------------------


@dataclass
class RecordDeps:
    """Record-agent handoff.

    `session_log` is the single source of truth for session content — including
    memories, which live at `session_log.memories` as a `list[MemoryItem]`.
    There is NO peer `memories` field on RecordDeps; the record agent reaches
    memories via `deps.session_log.memories`.
    """

    workspace: Path
    source_date: date = field(default_factory=date.today)
    session_id: str = ""
    summary: str = ""
    session_log: SessionLogEntry = field(default_factory=SessionLogEntry)
    is_continuation: bool = False


def _load_record_prompt() -> str:
    return (_PROMPTS_DIR / "record_agent.md").read_text(encoding="utf-8")


_record_agent: Agent[RecordDeps, RecordResult] | None = None

_DEFAULT_WRITE_PATTERNS: list[str] = ["dailys/*.md"]


def _get_record_agent(
    allowed_write_patterns: list[str] | None = None,
) -> Agent[RecordDeps, RecordResult]:
    global _record_agent
    if _record_agent is not None:
        return _record_agent

    patterns = (
        allowed_write_patterns if allowed_write_patterns is not None else _DEFAULT_WRITE_PATTERNS
    )

    agent: Agent[RecordDeps, RecordResult] = Agent(
        _build_model(),
        deps_type=RecordDeps,
        output_type=RecordResult,
        instructions=_load_record_prompt(),
        retries=2,
        output_retries=3,
        history_processors=[compact_history],
    )

    _register_base_tools(agent)

    @agent.tool
    async def write_file(ctx: RunContext[RecordDeps], path: str, content: str) -> str:
        """Write content to a vault file. Restricted to allowed path patterns."""
        normalized = os.path.normpath(path)
        if not any(fnmatch(normalized, p) for p in patterns):
            return f"Error: path '{path}' not allowed. Allowed patterns: {patterns}"
        workspace: Path = ctx.deps.workspace
        resolved = _safe_resolve(workspace, path)
        resolved.parent.mkdir(parents=True, exist_ok=True)
        resolved.write_text(content, encoding="utf-8")
        return f"Written {len(content)} chars to {path}"

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
        body = text[fm_match.end() :]

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
    async def flag_contradiction(ctx: RunContext[RecordDeps], file_path: str, reason: str) -> str:
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
        body = text[fm_match.end() :]

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

    _record_agent = agent
    return _record_agent


RECORD_LIMITS = UsageLimits(total_tokens_limit=1_500_000, tool_calls_limit=300)


def _format_session_log(sl: SessionLogEntry, summary: str) -> str:
    """Render the full SessionLogEntry for the record-agent prompt.

    Memories are a property of SessionLogEntry; they are rendered inline from
    the `memories` list (list[MemoryItem]) — not a separate section.
    """
    parts = [f"Summary: {summary}"]
    if sl.context:
        parts.append(f"Context: {sl.context}")
    if sl.key_exchanges:
        parts.append("Key Exchanges:")
        for item in sl.key_exchanges:
            parts.append(f"  - {item}")
    if sl.decisions_made:
        parts.append("Decisions Made:")
        for item in sl.decisions_made:
            parts.append(f"  - {item}")
    if sl.lessons_learned:
        parts.append("Lessons Learned:")
        for item in sl.lessons_learned:
            parts.append(f"  - {item}")
    if sl.memories:
        parts.append("Memory:")
        for m in sl.memories:
            reason = f" (reason: {m.reasoning})" if m.reasoning else ""
            parts.append(f"  - [{m.vault_target}] {m.source_date}: {m.content}{reason}")
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
    return "\n".join(parts)


async def run_record(
    deps: RecordDeps,
    allowed_write_patterns: list[str] | None = None,
) -> tuple[RecordResult, RunUsage, int, list[Any]]:
    daily_log = (
        await _read_vault_file(f"dailys/{deps.source_date.isoformat()}.md") or "(no daily log yet)"
    )

    vault_guide = await _read_vault_file("_guide.md") or ""

    sections = [
        "Record the session to the daily log and track reinforcement signals.",
        "",
        f"Session ID: {deps.session_id}",
    ]

    if deps.is_continuation:
        sections.append("")
        sections.append("## CONTINUATION MODE")
        sections.append("This is a CONTINUATION of an existing session (user closed and resumed).")
        sections.append(
            f"Find the session block with "
            f"`<!-- session_id: {deps.session_id} -->` "
            f"in the daily log."
        )
        sections.append(
            "APPEND new information to that existing block "
            "— do NOT create a new ### Session heading."
        )
        sections.append(
            "Add a `**Continued at [HH:MM]**:` marker before new content in each section."
        )

    sections.extend(
        [
            "",
            "## Session Log",
            _format_session_log(deps.session_log, deps.summary),
            "",
            "## Today's Daily Log (current state)",
            daily_log,
            "",
            "Write the session block to dailys/. "
            "Use read_frontmatter(path) for reinforcement checks.",
            "Use memu_search(query) to find matching vault files for reinforcement.",
            "Use read_file(path) to read full file content when needed.",
        ]
    )

    if vault_guide:
        sections.append("")
        sections.append("## Vault Guide (daily log format)")
        sections.append(vault_guide)

    agent = _get_record_agent(allowed_write_patterns=allowed_write_patterns)
    result = await agent.run(
        "\n".join(sections),
        deps=deps,
        usage_limits=RECORD_LIMITS,
    )
    msgs = result.all_messages()
    return result.output, result.usage(), _count_tool_calls(msgs), msgs


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

    _register_base_tools(agent)

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
    async def read_daily_log(ctx: RunContext[DeepDreamDeps], date_str: str) -> str:
        """Read a specific day's daily log (YYYY-MM-DD)."""
        content = await _read_vault_file(f"dailys/{date_str}.md")
        return content or f"No daily log for {date_str}"

    @agent.tool
    async def read_vault_index(ctx: RunContext[DeepDreamDeps], folder: str) -> str:
        """Read a vault folder's _index.md."""
        content = await _read_vault_file(f"{folder}/_index.md")
        return content or f"No _index.md for {folder}"

    _deep_dream_agent = agent
    return _deep_dream_agent


DEEP_DREAM_USAGE_LIMITS = UsageLimits(total_tokens_limit=500_000, tool_calls_limit=50)


async def run_deep_dream_consolidation(
    deps: DeepDreamDeps,
) -> tuple[ConsolidationOutput, RunUsage, int, list[Any]]:
    agent = _get_deep_dream_agent()
    sections = [
        "Consolidate memories. Produce updated MEMORY.md, daily summary, and vault updates.",
        "",
        # 1. Phase 1 — actionable decisions (primacy zone)
        deps.phase1_summary or "## Phase 1\nNo data.",
        "",
        # 2. Phase 2 — new knowledge (high)
        deps.phase2_summary or "## Phase 2\nNo data.",
        "",
        # 3. MEMORY.md — merge target (middle)
        "## Current MEMORY.md",
        deps.memory_md or "(empty)",
        "",
        # 4. Daily log — rewrite target (middle)
        "## Today's Daily Log",
        deps.daily_log or "(empty)",
        "",
        # 5. SOUL.md — alignment (recency zone)
        "## SOUL.md (alignment — do NOT modify)",
        deps.soul_md or "(empty)",
        "",
        "Tools: query_memu_memories(), read_daily_log(date), read_vault_index(folder)",
    ]
    result = await agent.run(
        "\n".join(sections),
        deps=deps,
        usage_limits=DEEP_DREAM_USAGE_LIMITS,
    )
    return (
        result.output,
        result.usage(),
        _count_tool_calls(result.all_messages()),
        result.all_messages(),
    )


HEALTH_FIX_LIMITS = UsageLimits(total_tokens_limit=200_000, tool_calls_limit=50)


async def run_health_fix(
    deps: DeepDreamDeps,
    message_history: list[Any],
    health_summary: str,
) -> tuple[RunUsage, int, list[Any]]:
    """Send health check results back to the consolidation agent to fix issues.

    Uses message_history from the consolidation run so the agent has full
    context of what was written. Token caching preserves the prefix.
    """
    agent = _get_deep_dream_agent()
    result = await agent.run(
        f"The health check found issues after your consolidation. "
        f"Fix them using the file tools:\n\n{health_summary}\n\n"
        f"For missing backlinks: read the target file, add a "
        f"`- [[source/file]]` entry under `## Related` (create section "
        f"if missing). "
        f"For orphan notes: read the folder's _index.md and add the "
        f"missing entry. "
        f"For missing frontmatter: read the file and add a YAML "
        f"frontmatter block at the top. "
        f"Fix as many issues as you can, then return your consolidation "
        f"output unchanged.",
        deps=deps,
        message_history=message_history,
        usage_limits=HEALTH_FIX_LIMITS,
    )
    return result.usage(), _count_tool_calls(result.all_messages()), result.all_messages()


def consolidation_to_dict(output: ConsolidationOutput) -> dict[str, Any]:
    return {
        "memory_md": output.memory_md,
        "daily_summary": output.daily_summary,
        "stats": output.stats.model_dump(),
        "vault_updates": {
            folder: [entry.model_dump() for entry in getattr(output.vault_updates, folder)]
            for folder in (
                "decisions",
                "projects",
                "patterns",
                "templates",
                "concepts",
                "connections",
                "lessons",
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

    _register_base_tools(agent)

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


PHASE1_USAGE_LIMITS = UsageLimits(total_tokens_limit=200_000, tool_calls_limit=25)


async def run_phase1_light_sleep(
    deps: DeepDreamDeps,
) -> tuple[LightSleepOutput, RunUsage, int, list[Any]]:
    agent = _get_phase1_agent()
    sections = [
        "Inventory, deduplicate, and score today's memories.",
        "Use query_memu_memories() for MemU data.",
        "",
        "## Current MEMORY.md",
        deps.memory_md or "(empty)",
        "",
        "## Today's Daily Log",
        deps.daily_log or "(empty)",
    ]
    result = await agent.run(
        "\n".join(sections),
        deps=deps,
        usage_limits=PHASE1_USAGE_LIMITS,
    )
    msgs = result.all_messages()
    return result.output, result.usage(), _count_tool_calls(msgs), msgs


# ---------------------------------------------------------------------------
# Phase 2: REM Sleep Agent
# ---------------------------------------------------------------------------


@dataclass
class Phase2Deps:
    source_date: date
    daily_logs: dict[str, str]  # date string → content
    vault_indexes: dict[str, str]  # folder name → _index.md content
    phase1_candidates: list[ScoredCandidate]
    phase1_text: str = ""
    vault_index_text: str = ""


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

    _register_base_tools(agent)

    @agent.tool
    async def read_daily_log(ctx: RunContext[Phase2Deps], date_str: str) -> str:
        """Return daily log content for a specific date (YYYY-MM-DD)."""
        content = ctx.deps.daily_logs.get(date_str)
        if content is None:
            return f"No daily log found for {date_str}"
        return content

    _phase2_agent = agent
    return _phase2_agent


PHASE2_USAGE_LIMITS = UsageLimits(total_tokens_limit=200_000, tool_calls_limit=25)


async def run_phase2_rem_sleep(
    deps: Phase2Deps,
) -> tuple[REMSleepOutput, RunUsage, int, list[Any]]:
    agent = _get_phase2_agent()
    sections = [
        "Analyze cross-session patterns and detect themes, connections, gaps.",
        "Use read_daily_log(date_str) to read specific daily logs.",
        "",
        "## Phase 1 Candidates",
        deps.phase1_text or "No Phase 1 candidates.",
        "",
        "## Vault Indexes",
        deps.vault_index_text or "No vault indexes available.",
    ]
    result = await agent.run(
        "\n".join(sections),
        deps=deps,
        usage_limits=PHASE2_USAGE_LIMITS,
    )
    msgs = result.all_messages()
    return result.output, result.usage(), _count_tool_calls(msgs), msgs


# ---------------------------------------------------------------------------
# Weekly Review Agent
# ---------------------------------------------------------------------------


@dataclass
class WeeklyReviewDeps:
    source_date: date
    week_number: str  # YYYY-WW format
    daily_logs: dict[str, str]  # date string -> content
    vault_indexes: dict[str, str]  # folder name -> _index.md content
    vault_guide: str = ""  # _guide.md content for review format reference


def _load_weekly_review_prompt() -> str:
    return (_PROMPTS_DIR / "weekly_review_agent.md").read_text(encoding="utf-8")


_weekly_review_agent: Agent[WeeklyReviewDeps, WeeklyReviewOutput] | None = None


def _get_weekly_review_agent() -> Agent[WeeklyReviewDeps, WeeklyReviewOutput]:
    global _weekly_review_agent
    if _weekly_review_agent is not None:
        return _weekly_review_agent

    agent: Agent[WeeklyReviewDeps, WeeklyReviewOutput] = Agent(
        _build_model(),
        deps_type=WeeklyReviewDeps,
        output_type=WeeklyReviewOutput,
        instructions=_load_weekly_review_prompt(),
        retries=2,
        output_retries=3,
        history_processors=[compact_history],
    )

    _register_base_tools(agent)

    @agent.tool
    async def read_daily_log(ctx: RunContext[WeeklyReviewDeps], date_str: str) -> str:
        """Return daily log content for a specific date (YYYY-MM-DD)."""
        content = ctx.deps.daily_logs.get(date_str)
        if content is None:
            return f"No daily log found for {date_str}"
        return content

    _weekly_review_agent = agent
    return _weekly_review_agent


WEEKLY_REVIEW_USAGE_LIMITS = UsageLimits(total_tokens_limit=100_000, tool_calls_limit=30)


async def run_weekly_review(
    deps: WeeklyReviewDeps,
) -> tuple[WeeklyReviewOutput, RunUsage, int]:
    agent = _get_weekly_review_agent()

    sections = [
        "Synthesize the past 7 days of daily logs into a weekly review. "
        "Read all daily logs and vault indexes before producing output.",
    ]
    if deps.vault_guide:
        sections.append("")
        sections.append("## Vault Guide (review format)")
        sections.append(deps.vault_guide)

    result = await agent.run(
        "\n".join(sections),
        deps=deps,
        usage_limits=WEEKLY_REVIEW_USAGE_LIMITS,
    )
    return result.output, result.usage(), _count_tool_calls(result.all_messages())


# Ensure temp dir parent exists
os.makedirs("/tmp/jarvis-dreams", exist_ok=True)
