import datetime

from app.core.logging import get_logger
from app.services.memory_files import read_vault_file, read_vault_file_lines

log = get_logger("jarvis.services.context_assembly")

MAX_MEMORY_LINES = 200

MEMORY_TOOLS_TEXT = (
    "You have access to memory tools during this session:\n"
    "- `memory_search`: Search past memories semantically. "
    "Use when you need context beyond what's in this injected memory.\n"
    "- `memory_add`: Store a new memory (decision, preference, pattern, "
    "correction, fact). Use when you observe important context worth remembering.\n"
    "- Local vault files are available at the JARVIS_CACHE_DIR path "
    "for direct file reading via Read/Grep tools."
)


async def _read_section(label: str, path: str, max_lines: int | None = None) -> str:
    if max_lines is not None:
        content = await read_vault_file_lines(path, max_lines)
    else:
        content = await read_vault_file(path)

    if content is None:
        log.debug("context_assembly.section.skipped", section=label, path=path)
        return ""

    return f"## {label}\n\n{content}"


async def assemble_context() -> str:
    today = datetime.date.today()
    yesterday = today - datetime.timedelta(days=1)
    today_str = today.isoformat()
    yesterday_str = yesterday.isoformat()

    sections: list[str] = []

    section_specs: list[tuple[str, str, int | None]] = [
        ("SOUL", "SOUL.md", None),
        ("IDENTITY", "IDENTITY.md", None),
        ("MEMORY", "MEMORY.md", MAX_MEMORY_LINES),
        (f"TODAY ({today_str})", f"dailys/{today_str}.md", None),
        (f"YESTERDAY ({yesterday_str})", f"dailys/{yesterday_str}.md", None),
        ("DECISIONS INDEX", "decisions/_index.md", None),
        ("PROJECTS INDEX", "projects/_index.md", None),
        ("PATTERNS INDEX", "patterns/_index.md", None),
        ("TEMPLATES INDEX", "templates/_index.md", None),
    ]

    for label, path, max_lines in section_specs:
        section = await _read_section(label, path, max_lines)
        if section:
            sections.append(section)

    sections.append(f"## MEMORY TOOLS\n\n{MEMORY_TOOLS_TEXT}")

    assembled = "\n\n".join(sections)
    log.info("context_assembly.assembled", section_count=len(sections), length=len(assembled))
    return assembled
