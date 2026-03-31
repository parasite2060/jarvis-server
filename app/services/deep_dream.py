import re
from datetime import date
from typing import Any

from app.core.logging import get_logger
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
