import re
from dataclasses import dataclass
from datetime import UTC, date, datetime

from app.core.logging import get_logger
from app.services.memory_files import (
    count_vault_file_lines,
    read_vault_file,
    write_vault_file,
)

log = get_logger("jarvis.services.memory_updater")

MEMORY_OVERFLOW_THRESHOLD = 180


@dataclass(frozen=True)
class MemoryItem:
    type: str
    content: str
    reasoning: str | None = None
    vault_target: str | None = None


def _format_memory_line(item: MemoryItem) -> str:
    line = f"- [{item.type}] {item.content}"
    if item.reasoning:
        line += f" -- {item.reasoning}"
    if len(line) > 150:
        line = line[:147] + "..."
    return line


async def append_to_memory_md(
    memories: list[MemoryItem],
    session_summary: str,
    source_date: date,
) -> dict[str, object]:
    now = datetime.now(UTC)
    date_header = f"### {source_date.isoformat()} {now.strftime('%H:%M')}"

    memory_lines = [_format_memory_line(m) for m in memories]
    append_block = date_header + "\n\n" + "\n".join(memory_lines) + "\n"

    existing = await read_vault_file("MEMORY.md")
    if existing is None:
        existing = ""

    recent_marker = "## Recent"
    idx = existing.find(recent_marker)
    if idx != -1:
        insert_pos = idx + len(recent_marker)
        # Skip any trailing whitespace/newlines after the heading
        while insert_pos < len(existing) and existing[insert_pos] in ("\n", "\r"):
            insert_pos += 1
        after_recent = existing[insert_pos:]
        updated = existing[:idx] + recent_marker + "\n\n" + append_block + "\n" + after_recent
    else:
        updated = existing + "\n" + recent_marker + "\n\n" + append_block

    await write_vault_file("MEMORY.md", updated)

    line_count = await count_vault_file_lines("MEMORY.md")
    log.info(
        "memory_updater.memory_md.appended",
        line_count=line_count,
        memories_count=len(memories),
    )

    return {
        "path": "MEMORY.md",
        "action": "append",
        "line_count": line_count,
        "memory_overflow": line_count > MEMORY_OVERFLOW_THRESHOLD,
    }


async def append_to_daily_log(
    memories: list[MemoryItem],
    session_summary: str,
    source_date: date,
) -> dict[str, object]:
    daily_path = f"dailys/{source_date.isoformat()}.md"

    existing = await read_vault_file(daily_path)

    if existing is None:
        frontmatter = (
            "---\n"
            "type: daily\n"
            "tags: [daily, sessions]\n"
            f"created: {source_date.isoformat()}\n"
            f"updated: {source_date.isoformat()}\n"
            "---\n\n"
            f"# {source_date.isoformat()}\n"
        )
        existing = frontmatter
        action = "create"
        log.info("memory_updater.daily_log.created", path=daily_path)
    else:
        action = "append"

    session_count = len(re.findall(r"^## Session \d+", existing, re.MULTILINE))
    session_num = session_count + 1

    memory_lines = [_format_memory_line(m) for m in memories]
    session_block = (
        f"\n## Session {session_num}\n\n"
        f"**Summary:** {session_summary}\n\n"
        "**Memories extracted:**\n" + "\n".join(memory_lines) + "\n"
    )

    # Update frontmatter `updated` date
    updated_content = re.sub(
        r"^(updated:\s*)\S+",
        rf"\g<1>{source_date.isoformat()}",
        existing,
        count=1,
        flags=re.MULTILINE,
    )
    updated_content += session_block

    await write_vault_file(daily_path, updated_content)
    log.info(
        "memory_updater.daily_log.appended",
        path=daily_path,
        session_num=session_num,
    )

    return {"path": daily_path, "action": action}


async def update_memory_files(
    dream_id: int,
    memories: list[MemoryItem],
    session_summary: str,
    source_date: date,
) -> list[dict[str, object]]:
    files_modified: list[dict[str, object]] = []

    # Update MEMORY.md
    try:
        result = await append_to_memory_md(memories, session_summary, source_date)
        files_modified.append(result)
    except Exception as exc:
        log.error(
            "memory_updater.failed",
            dream_id=dream_id,
            file="MEMORY.md",
            error=str(exc),
        )
        files_modified.append({"path": "MEMORY.md", "action": "error", "error": str(exc)})

    # Update daily log
    try:
        result = await append_to_daily_log(memories, session_summary, source_date)
        files_modified.append(result)
    except Exception as exc:
        log.error(
            "memory_updater.failed",
            dream_id=dream_id,
            file=f"dailys/{source_date.isoformat()}.md",
            error=str(exc),
        )
        files_modified.append(
            {
                "path": f"dailys/{source_date.isoformat()}.md",
                "action": "error",
                "error": str(exc),
            }
        )

    return files_modified
