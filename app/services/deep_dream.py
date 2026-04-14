import math
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any

from app.core.logging import get_logger
from app.services.dream_models import HealthReport
from app.services.memory_files import read_vault_file, write_vault_file
from app.services.memu_client import memu_memorize, memu_retrieve

log = get_logger("jarvis.services.deep_dream")

MAX_MEMORY_LINES = 200

RELATIVE_DATE_PATTERN = re.compile(
    r"\b(yesterday|today|tomorrow|last week|next week|last month|next month)\b",
    re.IGNORECASE,
)


async def gather_consolidation_inputs(source_date: date) -> dict[str, Any] | None:
    log.info("deep_dream.gather.started", source_date=source_date.isoformat())

    memu_result = await memu_retrieve(
        query=f"memories from {source_date.isoformat()}",
        method="rag",
    )
    memories: list[dict[str, Any]] = memu_result.get("memories", [])
    if not memories:
        log.info("deep_dream.gather.skipped", reason="no_memories")
        return None

    memory_md = await read_vault_file("MEMORY.md") or ""
    daily_log = await read_vault_file(f"dailys/{source_date.isoformat()}.md") or ""
    soul_md = await read_vault_file("SOUL.md") or ""

    log.info(
        "deep_dream.gather.completed",
        memu_count=len(memories),
        memory_md_length=len(memory_md),
        daily_log_length=len(daily_log),
    )

    return {
        "memu_memories": memories,
        "memory_md": memory_md,
        "daily_log": daily_log,
        "soul_md": soul_md,
    }


async def validate_consolidated_output(consolidation_result: dict[str, Any]) -> dict[str, Any]:
    log.info("deep_dream.validation.started")
    warnings: list[str] = []

    memory_md: str = consolidation_result.get("memory_md", "")
    if not memory_md.strip():
        msg = "Consolidated memory_md is empty"
        raise ValueError(msg)

    lines = memory_md.splitlines()
    line_count = len(lines)

    if line_count > MAX_MEMORY_LINES:
        warnings.append(f"memory_md exceeded {MAX_MEMORY_LINES} lines ({line_count}), truncating")
        log.warning("deep_dream.validation.truncated", original_lines=line_count)
        lines = lines[:MAX_MEMORY_LINES]
        memory_md = "\n".join(lines)
        consolidation_result["memory_md"] = memory_md
        line_count = MAX_MEMORY_LINES

    relative_matches = RELATIVE_DATE_PATTERN.findall(memory_md)
    if relative_matches:
        warnings.append(f"Found relative dates in memory_md: {relative_matches}")
        log.warning("deep_dream.validation.relative_dates", matches=relative_matches)

    daily_summary: str = consolidation_result.get("daily_summary", "")
    if not daily_summary.strip():
        msg = "Consolidated daily_summary is empty"
        raise ValueError(msg)

    log.info(
        "deep_dream.validation.completed",
        line_count=line_count,
        warning_count=len(warnings),
    )

    return {
        **consolidation_result,
        "line_count": line_count,
        "warnings": warnings,
    }


async def write_consolidated_files(
    validated_result: dict[str, Any],
    source_date: date,
) -> list[dict[str, str]]:
    log.info("deep_dream.files.started", source_date=source_date.isoformat())

    current_memory = await read_vault_file("MEMORY.md") or ""
    backup_path = f"topics/memory-backup-{source_date.isoformat()}.md"
    await write_vault_file(backup_path, current_memory)

    await write_vault_file("MEMORY.md", validated_result["memory_md"])

    daily_path = f"dailys/{source_date.isoformat()}.md"
    existing_daily = await read_vault_file(daily_path) or ""

    frontmatter = ""
    if existing_daily.startswith("---"):
        end_idx = existing_daily.find("---", 3)
        if end_idx != -1:
            frontmatter = existing_daily[: end_idx + 3] + "\n\n"

    daily_content = frontmatter + validated_result["daily_summary"]
    await write_vault_file(daily_path, daily_content)

    files_modified = [
        {"path": "MEMORY.md", "action": "rewrite"},
        {"path": daily_path, "action": "rewrite"},
        {"path": backup_path, "action": "create"},
    ]

    log.info(
        "deep_dream.files.written",
        files_count=len(files_modified),
    )

    return files_modified


SECTION_HEADERS = ("## Strong Patterns", "## Decisions", "## Facts")


def _extract_memory_entries(memory_md_content: str) -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []
    current_section: str | None = None

    for line in memory_md_content.splitlines():
        stripped = line.strip()
        if stripped in SECTION_HEADERS:
            current_section = stripped.removeprefix("## ")
            continue
        if stripped.startswith("## "):
            current_section = None
            continue
        if current_section and stripped.startswith("- "):
            content = stripped.removeprefix("- ").strip()
            if content:
                entries.append({"type": current_section, "content": content})

    return entries


async def align_memu_with_memory(
    memory_md_content: str,
    source_date: date,
) -> dict[str, int]:
    log.info("deep_dream.memu_align.started", source_date=source_date.isoformat())

    entries = _extract_memory_entries(memory_md_content)
    if not entries:
        log.info("deep_dream.memu_align.no_entries")
        return {"items_synced": 0, "errors": 0}

    items_synced = 0
    errors = 0

    for entry in entries:
        messages = [
            {
                "role": "user",
                "content": (
                    f"[{entry['type']}] {entry['content']} "
                    f"(source: deep_dream, date: {source_date.isoformat()}, "
                    f"type: consolidated_memory)"
                ),
            }
        ]
        try:
            await memu_memorize(messages)
            items_synced += 1
        except Exception as exc:
            errors += 1
            log.warning(
                "deep_dream.memu_align.item_failed",
                entry_type=entry["type"],
                error=str(exc),
            )

    log.info(
        "deep_dream.memu_align.completed",
        items_synced=items_synced,
        errors=errors,
        total=len(entries),
    )

    return {"items_synced": items_synced, "errors": errors}


# ---------------------------------------------------------------------------
# Phase 3: Scoring (deterministic Python, NOT LLM)
# ---------------------------------------------------------------------------

DEFAULT_SCORING_WEIGHTS: dict[str, float] = {
    "frequency": 0.25,
    "recency": 0.25,
    "relevance": 0.20,
    "consistency": 0.20,
    "breadth": 0.10,
}

DEFAULT_DECAY_RATE = 0.03


def calculate_candidate_score(
    reinforcement_count: int,
    days_since_reinforced: int,
    in_active_project: bool,
    has_contradiction: bool,
    context_count: int,
    weights: dict[str, float] | None = None,
    decay_rate: float = DEFAULT_DECAY_RATE,
    is_reference: bool = False,
) -> float:
    if is_reference:
        return 1.0  # Terminal node: references are permanent, never scored for pruning

    w = weights or DEFAULT_SCORING_WEIGHTS
    freq = min(reinforcement_count / 10.0, 1.0)
    recency = math.exp(-decay_rate * days_since_reinforced)
    relevance = 1.0 if in_active_project else 0.3
    consistency = 0.0 if has_contradiction else 1.0
    breadth = min(context_count / 5.0, 1.0)
    return (
        w.get("frequency", 0.25) * freq
        + w.get("recency", 0.25) * recency
        + w.get("relevance", 0.20) * relevance
        + w.get("consistency", 0.20) * consistency
        + w.get("breadth", 0.10) * breadth
    )


# ---------------------------------------------------------------------------
# Phase 3: Health checks (deterministic Python, NOT LLM)
# ---------------------------------------------------------------------------

VAULT_FOLDERS = (
    "decisions",
    "patterns",
    "projects",
    "templates",
    "concepts",
    "connections",
    "lessons",
    "references",
    "reviews",
)

STALE_DAYS_DEFAULT = 60
MEMORY_OVERFLOW_THRESHOLD = 180


async def run_health_checks(
    workspace: Path,
    knowledge_gaps: list[str] | None = None,
    stale_days: int = STALE_DAYS_DEFAULT,
) -> HealthReport:
    orphan_notes: list[str] = []
    stale_notes: list[str] = []
    missing_frontmatter: list[str] = []
    unresolved_contradictions: list[str] = []
    memory_overflow = False

    today = date.today()

    for folder in VAULT_FOLDERS:
        folder_path = workspace / folder
        if not folder_path.is_dir():
            continue

        index_path = folder_path / "_index.md"
        index_content = ""
        if index_path.is_file():
            index_content = index_path.read_text(encoding="utf-8")

        for md_file in sorted(folder_path.glob("*.md")):
            if md_file.name == "_index.md":
                continue

            rel_path = f"{folder}/{md_file.name}"
            text = md_file.read_text(encoding="utf-8")

            # Check if referenced in _index.md
            stem = md_file.stem
            if index_content and stem not in index_content and md_file.name not in index_content:
                orphan_notes.append(rel_path)

            # Check frontmatter
            if not text.startswith("---"):
                missing_frontmatter.append(rel_path)
                continue

            fm_end = text.find("---", 3)
            if fm_end == -1:
                missing_frontmatter.append(rel_path)
                continue

            frontmatter = text[3:fm_end]

            # Skip contradiction and stale checks for references/ (terminal nodes)
            if folder == "references":
                continue

            # Check for contradictions
            if re.search(r"has_contradiction:\s*true", frontmatter, re.IGNORECASE):
                unresolved_contradictions.append(rel_path)

            # Check for stale notes
            reviewed_match = re.search(
                r"last_reviewed:\s*(\d{4}-\d{2}-\d{2})", frontmatter
            )
            if reviewed_match:
                try:
                    last_reviewed = datetime.strptime(
                        reviewed_match.group(1), "%Y-%m-%d"
                    ).date()
                    if (today - last_reviewed).days > stale_days:
                        stale_notes.append(rel_path)
                except ValueError:
                    pass

    # Check MEMORY.md overflow
    memory_path = workspace / "MEMORY.md"
    if memory_path.is_file():
        line_count = len(memory_path.read_text(encoding="utf-8").splitlines())
        if line_count > MEMORY_OVERFLOW_THRESHOLD:
            memory_overflow = True

    gaps = knowledge_gaps or []

    total_issues = (
        len(orphan_notes)
        + len(stale_notes)
        + len(missing_frontmatter)
        + len(unresolved_contradictions)
        + (1 if memory_overflow else 0)
        + len(gaps)
    )

    return HealthReport(
        orphan_notes=orphan_notes,
        stale_notes=stale_notes,
        missing_frontmatter=missing_frontmatter,
        unresolved_contradictions=unresolved_contradictions,
        memory_overflow=memory_overflow,
        knowledge_gaps=gaps,
        total_issues=total_issues,
    )
