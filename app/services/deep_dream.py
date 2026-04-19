import math
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any

from app.config import settings
from app.core.logging import get_logger
from app.services.dream_models import HealthReport
from app.services.memory_files import read_vault_file, write_vault_file
from app.services.memu_client import memu_memorize, memu_retrieve
from app.services.vault_updater import regenerate_index

log = get_logger("jarvis.services.deep_dream")

MAX_MEMORY_LINES = 200

RELATIVE_DATE_PATTERN = re.compile(
    r"\b(yesterday|today|tomorrow|last week|next week|last month|next month)\b",
    re.IGNORECASE,
)


async def gather_consolidation_inputs(source_date: date) -> dict[str, Any] | None:
    log.info("deep_dream.gather.started", source_date=source_date.isoformat())

    # MemU is supplementary — graceful degradation if unavailable
    memories: list[dict[str, Any]] = []
    try:
        memu_result = await memu_retrieve(
            query=f"memories from {source_date.isoformat()}",
            method="rag",
        )
        memories = memu_result.get("memories", [])
    except Exception as exc:
        log.warning(
            "deep_dream.gather.memu_failed",
            error=str(exc),
            source_date=source_date.isoformat(),
        )

    memory_md = await read_vault_file("MEMORY.md") or ""
    daily_log = await read_vault_file(f"dailys/{source_date.isoformat()}.md") or ""
    soul_md = await read_vault_file("SOUL.md") or ""

    # Skip if there's truly nothing to consolidate (no memories AND no daily log)
    if not memories and not daily_log.strip():
        log.info("deep_dream.gather.skipped", reason="no_content")
        return None

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


async def validate_vault_post_fix(source_date: date) -> dict[str, Any]:
    log.info("deep_dream.post_fix_validation.started", source_date=source_date.isoformat())

    warnings: list[str] = []
    validation_failed = False

    memory_md = await read_vault_file("MEMORY.md")
    if memory_md is None or not memory_md.strip():
        warnings.append("MEMORY.md is missing or empty after health fix")
        validation_failed = True
    else:
        line_count = len(memory_md.splitlines())
        if line_count > MAX_MEMORY_LINES:
            warnings.append(
                f"MEMORY.md exceeds {MAX_MEMORY_LINES} lines after health fix ({line_count})"
            )
            validation_failed = True

    daily_path = f"dailys/{source_date.isoformat()}.md"
    daily_log = await read_vault_file(daily_path)
    if daily_log is None:
        warnings.append(f"Daily log {daily_path} missing after health fix")
        validation_failed = True

    # Story 11.13: wiki-link resolution check catches fabricated or
    # empty-filename links introduced by any prior step (agent or manual).
    unresolved = _find_broken_wikilinks(Path(settings.ai_memory_repo_path))
    if unresolved:
        preview = "; ".join(unresolved[:5])
        warnings.append(f"unresolved_wikilinks: {preview}")
        validation_failed = True

    log.info(
        "deep_dream.post_fix_validation.completed",
        source_date=source_date.isoformat(),
        validation_failed=validation_failed,
        warning_count=len(warnings),
        unresolved_wikilinks=len(unresolved),
    )

    return {
        "warnings": warnings,
        "validation_failed": validation_failed,
        "unresolved_wikilinks": unresolved,
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
    is_failed_lesson: bool = False,
) -> float:
    if is_reference:
        return 1.0  # Terminal node: references are permanent, never scored for pruning

    if is_failed_lesson:
        return 1.0  # Anti-repetition: never prune failed lessons

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

WIKILINK_SCAN_EXCLUDES = (".backups", "transcripts", "dailys")
WIKILINK_EXTRACT_RE = re.compile(r"\[\[([^\]\n]+)\]\]")


def _find_broken_wikilinks(vault_root: Path) -> list[str]:
    """Walk the vault, extract wiki-links, and flag any that don't resolve.

    A link `[[target]]` resolves when `{vault_root}/{target}.md` exists.
    Empty targets (`[[decisions/]]`), malformed targets (no `/`), or targets
    that point to non-existent files are flagged.

    Excludes `.backups/`, `transcripts/`, `dailys/` folders per AC8.
    """
    unresolved: list[str] = []
    if not vault_root.is_dir():
        return unresolved

    for md_file in vault_root.rglob("*.md"):
        try:
            rel = md_file.relative_to(vault_root)
        except ValueError:
            continue
        parts = rel.parts
        if parts and parts[0] in WIKILINK_SCAN_EXCLUDES:
            continue
        try:
            text = md_file.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue

        source_rel = rel.as_posix()
        seen: set[str] = set()
        for match in WIKILINK_EXTRACT_RE.findall(text):
            raw = match.split("|", 1)[0].strip()
            if raw in seen:
                continue
            seen.add(raw)

            if not raw or raw.endswith("/") or "/" not in raw:
                unresolved.append(f"{source_rel} → [[{raw}]] (unresolved)")
                continue

            target_name = raw if raw.endswith(".md") else f"{raw}.md"
            target_path = vault_root / target_name
            if not target_path.is_file():
                unresolved.append(f"{source_rel} → [[{raw}]] (unresolved)")

    return unresolved


async def run_health_checks(
    workspace: Path,
    knowledge_gaps: list[str] | None = None,
    stale_days: int = STALE_DAYS_DEFAULT,
) -> HealthReport:
    orphan_notes: list[str] = []
    stale_notes: list[str] = []
    missing_frontmatter: list[str] = []
    unresolved_contradictions: list[str] = []
    unclassified_lessons: list[str] = []
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
            reviewed_match = re.search(r"last_reviewed:\s*(\d{4}-\d{2}-\d{2})", frontmatter)
            if reviewed_match:
                try:
                    last_reviewed = datetime.strptime(reviewed_match.group(1), "%Y-%m-%d").date()
                    if (today - last_reviewed).days > stale_days:
                        stale_notes.append(rel_path)
                except ValueError:
                    pass

            # Check for unclassified lessons (older than 90 days, no outcome field)
            if folder == "lessons":
                created_match = re.search(r"created:\s*(\d{4}-\d{2}-\d{2})", frontmatter)
                has_outcome = re.search(r"outcome:\s*\w+", frontmatter) is not None
                if created_match and not has_outcome:
                    try:
                        created_date = datetime.strptime(created_match.group(1), "%Y-%m-%d").date()
                        if (today - created_date).days > 90:
                            unclassified_lessons.append(rel_path)
                    except ValueError:
                        pass

    # Check MEMORY.md overflow
    memory_path = workspace / "MEMORY.md"
    if memory_path.is_file():
        line_count = len(memory_path.read_text(encoding="utf-8").splitlines())
        if line_count > MEMORY_OVERFLOW_THRESHOLD:
            memory_overflow = True

    # Detect missing backlinks
    wikilink_re = re.compile(r"\[\[([^\]]+)\]\]")
    missing_backlinks: list[str] = []

    for folder in VAULT_FOLDERS:
        folder_path = workspace / folder
        if not folder_path.is_dir():
            continue

        for md_file in sorted(folder_path.glob("*.md")):
            if md_file.name == "_index.md":
                continue

            source_rel = f"{folder}/{md_file.name}"
            source_slug = f"{folder}/{md_file.stem}"
            text = md_file.read_text(encoding="utf-8")
            links = wikilink_re.findall(text)

            for link in links:
                link_clean = link.split("|")[0].strip()
                parts = link_clean.split("/", 1)
                if len(parts) != 2:
                    continue

                target_folder = parts[0]
                if target_folder not in VAULT_FOLDERS:
                    continue

                # Skip if source is in references/ (terminal: no outbound expected)
                if folder == "references":
                    continue

                # Skip if target is in references/ (terminal: no reverse link expected)
                if target_folder == "references":
                    continue

                target_name = parts[1]
                if not target_name.endswith(".md"):
                    target_name += ".md"
                target_path = workspace / target_folder / target_name
                if not target_path.is_file():
                    continue

                target_content = target_path.read_text(encoding="utf-8")
                if f"[[{source_slug}]]" not in target_content:
                    target_rel = f"{target_folder}/{target_name}"
                    entry = f"{source_rel} \u2192 {target_rel} (no reverse link)"
                    if entry not in missing_backlinks:
                        missing_backlinks.append(entry)

    gaps = knowledge_gaps or []

    broken_wikilinks = _find_broken_wikilinks(workspace)

    total_issues = (
        len(orphan_notes)
        + len(stale_notes)
        + len(missing_frontmatter)
        + len(unresolved_contradictions)
        + (1 if memory_overflow else 0)
        + len(gaps)
        + len(missing_backlinks)
        + len(unclassified_lessons)
        + len(broken_wikilinks)
    )

    return HealthReport(
        orphan_notes=orphan_notes,
        stale_notes=stale_notes,
        missing_frontmatter=missing_frontmatter,
        unresolved_contradictions=unresolved_contradictions,
        memory_overflow=memory_overflow,
        knowledge_gaps=gaps,
        missing_backlinks=missing_backlinks,
        unclassified_lessons=unclassified_lessons,
        broken_wikilinks=broken_wikilinks,
        total_issues=total_issues,
    )


# ---------------------------------------------------------------------------
# Auto-fix: deterministic fixes for health check issues
# ---------------------------------------------------------------------------

WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")

DEFAULT_FRONTMATTER = """\
---
type: {type}
status: draft
tags: []
created: {date}
updated: {date}
last_reviewed: {date}
reinforcement_count: 0
confidence: low
---
"""


def _index_contains(existing: str, filename: str) -> bool:
    """Idempotency check: does the existing _index.md already list this basename?"""
    needle = f"]({filename})"
    return any(needle in line for line in existing.splitlines() if line.lstrip().startswith("- ["))


async def _fix_orphan_notes(
    workspace: Path,
    orphans: list[str],
    source_date: date,
) -> int:
    """Bootstrap missing `_index.md` via regenerate_index, or append missing entries.

    Groups orphans by folder. For each folder: if `_index.md` is absent, call
    `regenerate_index` (which globs all `*.md` and builds a fresh index with
    frontmatter — naturally includes the orphans). If present, append one line
    per orphan not already listed (basename-based idempotency).
    """
    fixed_orphans = 0
    by_folder: dict[str, list[str]] = {}
    for rel in orphans:
        parts = rel.split("/", 1)
        if len(parts) != 2:
            continue
        folder = parts[0]
        by_folder.setdefault(folder, []).append(rel)

    for folder, folder_orphans in by_folder.items():
        index_path = workspace / folder / "_index.md"

        if not index_path.is_file():
            try:
                await regenerate_index(folder, source_date, summaries={})
            except Exception as exc:
                log.warning(
                    "deep_dream.auto_fix.index_bootstrap_failed",
                    folder=folder,
                    error=str(exc),
                )
                continue
            fixed_orphans += len(folder_orphans)
            continue

        index_content = index_path.read_text(encoding="utf-8")
        changed = False
        for rel_path in folder_orphans:
            filename = rel_path.split("/", 1)[1]
            stem = filename.removesuffix(".md")
            title = stem.replace("-", " ").title()
            if _index_contains(index_content, filename):
                continue
            entry = f"- [{title}]({filename})"
            index_content = index_content.rstrip() + "\n" + entry + "\n"
            changed = True
            fixed_orphans += 1
        if changed:
            index_path.write_text(index_content, encoding="utf-8")

    return fixed_orphans


async def auto_fix_health_issues(
    workspace: Path,
    report: HealthReport,
    source_date: date | None = None,
) -> dict[str, int]:
    """Auto-fix deterministic health issues. Returns counts of fixes applied."""
    fixed_backlinks = 0
    fixed_frontmatter = 0

    today = date.today()
    today_str = today.isoformat()
    effective_source_date = source_date or today

    # 1. Fix missing backlinks — deterministic Python writer (Story 11.13).
    # Stem comes from the source's filesystem path (no LLM guessing).
    # Skips references/ targets (terminal nodes, no reverse link expected).
    for entry in report.missing_backlinks:
        parts = entry.split(" → ")
        if len(parts) != 2:
            continue
        source_rel = parts[0].strip()
        target_rel = parts[1].split(" (")[0].strip()

        if target_rel.startswith("references/"):
            continue

        source_path = workspace / source_rel
        if not source_path.is_file():
            log.warning(
                "deep_dream.backlink_fix.source_missing",
                source=source_rel,
                target=target_rel,
            )
            continue

        target_path = workspace / target_rel
        if not target_path.is_file():
            continue

        source_slug = source_rel.removesuffix(".md")
        new_link_inner = f"[[{source_slug}]]"
        new_line = f"- {new_link_inner}"

        content = target_path.read_text(encoding="utf-8")

        if new_link_inner in content:
            continue

        if "## Related" in content:
            related_idx = content.index("## Related")
            next_section = content.find("\n## ", related_idx + len("## Related"))
            insert_pos = next_section if next_section != -1 else len(content)
            prefix = content[:insert_pos].rstrip()
            suffix = content[insert_pos:]
            rebuilt = prefix + "\n" + new_line + "\n"
            if suffix:
                rebuilt += suffix if suffix.startswith("\n") else "\n" + suffix
            target_path.write_text(rebuilt, encoding="utf-8")
        else:
            rebuilt = content.rstrip() + "\n\n## Related\n" + new_line + "\n"
            target_path.write_text(rebuilt, encoding="utf-8")
        fixed_backlinks += 1

    # 2. Fix missing frontmatter — add default template
    for rel_path in report.missing_frontmatter:
        file_path = workspace / rel_path
        if not file_path.is_file():
            continue

        folder = rel_path.split("/")[0]
        type_map = {
            "decisions": "decision",
            "patterns": "pattern",
            "projects": "project",
            "templates": "template",
            "concepts": "concept",
            "connections": "connection",
            "lessons": "lesson",
            "references": "reference",
            "reviews": "review",
        }
        file_type = type_map.get(folder, "unknown")
        fm = DEFAULT_FRONTMATTER.format(type=file_type, date=today_str)

        content = file_path.read_text(encoding="utf-8")
        if not content.startswith("---"):
            file_path.write_text(fm + "\n" + content, encoding="utf-8")
            fixed_frontmatter += 1

    # 3. Fix orphan notes — bootstrap `_index.md` via regenerate_index when
    # missing, or append idempotently when present (Story 11.12).
    fixed_orphans = await _fix_orphan_notes(workspace, report.orphan_notes, effective_source_date)

    fixes = {
        "backlinks_fixed": fixed_backlinks,
        "frontmatter_fixed": fixed_frontmatter,
        "orphans_fixed": fixed_orphans,
        "total_fixed": fixed_backlinks + fixed_frontmatter + fixed_orphans,
    }

    if fixes["total_fixed"] > 0:
        log.info(
            "deep_dream.auto_fix.completed",
            **fixes,
        )

    return fixes
