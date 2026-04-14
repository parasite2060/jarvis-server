import datetime
import json
import re

from sqlalchemy import select

from app.core.logging import get_logger
from app.models.db import async_session_factory
from app.models.tables import Dream
from app.services.dream_models import HealthReport
from app.services.memory_files import read_vault_file, read_vault_file_lines

log = get_logger("jarvis.services.context_assembly")

MAX_MEMORY_LINES = 200
HEALTH_REPORT_PATTERN = re.compile(r"health_report=(\{.*\})")

MEMORY_TOOLS_TEXT = (
    "You have access to memory tools during this session:\n"
    "- `memory_search`: Search past memories semantically. "
    "Use when you need context beyond what's in this injected memory.\n"
    "- `memory_add`: Store a new memory (decision, preference, pattern, "
    "correction, fact). Use when you observe important context worth remembering."
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


async def get_latest_health_report() -> HealthReport | None:
    try:
        async with async_session_factory() as session:
            result = await session.execute(
                select(Dream)
                .where(Dream.type == "deep", Dream.status == "completed")
                .order_by(Dream.completed_at.desc())
                .limit(1)
            )
            dream = result.scalar_one_or_none()
            if not dream or not dream.output_raw:
                return None

            match = HEALTH_REPORT_PATTERN.search(dream.output_raw)
            if not match:
                return None

            data = json.loads(match.group(1))
            return HealthReport(**data)
    except Exception:
        log.warning("context_assembly.health_report.failed", exc_info=True)
        return None


def format_health_summary(report: HealthReport) -> str:
    issues: list[str] = []
    if report.orphan_notes:
        issues.append(f"{len(report.orphan_notes)} orphan notes")
    if report.stale_notes:
        issues.append(f"{len(report.stale_notes)} stale notes")
    if report.unresolved_contradictions:
        issues.append(
            f"{len(report.unresolved_contradictions)} unresolved contradictions"
        )
    if report.missing_frontmatter:
        issues.append(f"{len(report.missing_frontmatter)} missing frontmatter")
    if report.memory_overflow:
        issues.append("MEMORY.md approaching overflow")
    if report.knowledge_gaps:
        issues.append(f"{len(report.knowledge_gaps)} knowledge gaps")

    if not issues:
        return ""
    return f"\u26a0 Vault health: {', '.join(issues)}"


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

    health_report = await get_latest_health_report()
    if health_report:
        health_line = format_health_summary(health_report)
        if health_line:
            sections.append(f"## VAULT HEALTH\n\n{health_line}")

    sections.append(f"## MEMORY TOOLS\n\n{MEMORY_TOOLS_TEXT}")

    assembled = "\n\n".join(sections)
    log.info("context_assembly.assembled", section_count=len(sections), length=len(assembled))
    return assembled
