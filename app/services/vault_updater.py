import asyncio
import hashlib
import re
from datetime import date
from pathlib import Path
from typing import Any

from sqlalchemy import select

from app.config import settings
from app.core.logging import get_logger
from app.models.db import async_session_factory
from app.models.tables import FileManifest
from app.services.memory_files import read_vault_file, write_vault_file

log = get_logger("jarvis.services.vault_updater")

VAULT_FOLDERS = ("decisions", "projects", "patterns", "templates")

FOLDER_TYPE_MAP: dict[str, str] = {
    "decisions": "decision",
    "projects": "project",
    "patterns": "pattern",
    "templates": "template",
}


def build_frontmatter(
    file_type: str,
    tags: list[str],
    created: date,
    updated: date,
) -> str:
    tags_str = ", ".join(tags)
    return (
        "---\n"
        f"type: {file_type}\n"
        f"tags: [{tags_str}]\n"
        f"created: {created.isoformat()}\n"
        f"updated: {updated.isoformat()}\n"
        f"last_reviewed: {updated.isoformat()}\n"
        "---\n"
    )


def extract_created_date(content: str) -> str | None:
    match = re.search(r"^created:\s*(\d{4}-\d{2}-\d{2})", content, re.MULTILINE)
    return match.group(1) if match else None


def _extract_title(content: str) -> str | None:
    match = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
    return match.group(1).strip() if match else None


def _extract_first_sentence(content: str) -> str:
    body_match = re.search(r"^#\s+.+\n+(.+)", content, re.MULTILINE)
    if body_match:
        sentence = body_match.group(1).strip()
        return sentence[:97] + "..." if len(sentence) > 100 else sentence
    return ""


def _compute_file_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


async def write_vault_folder_file(
    folder: str,
    entry: dict[str, Any],
    source_date: date,
) -> dict[str, str]:
    filename: str = entry["filename"]
    relative_path = f"{folder}/{filename}"
    created_date = source_date
    action: str = entry["action"]

    if action == "update":
        existing = await read_vault_file(relative_path)
        if existing is not None:
            existing_created = extract_created_date(existing)
            if existing_created is not None:
                created_date = date.fromisoformat(existing_created)
        else:
            action = "create"

    file_type = FOLDER_TYPE_MAP[folder]
    frontmatter = build_frontmatter(
        file_type=file_type,
        tags=entry.get("tags", []),
        created=created_date,
        updated=source_date,
    )
    full_content = frontmatter + "\n" + entry["content"]
    await write_vault_file(relative_path, full_content)

    log.info(
        "vault_updater.file.written",
        path=relative_path,
        action=action,
    )
    return {"path": relative_path, "action": action}


async def regenerate_index(
    folder: str,
    source_date: date,
    summaries: dict[str, str] | None = None,
) -> dict[str, str]:
    repo_root = Path(settings.ai_memory_repo_path)
    folder_path = repo_root / folder

    md_files: list[Path] = await asyncio.to_thread(
        lambda: sorted([f for f in folder_path.glob("*.md") if f.name != "_index.md"])
    )

    entries: list[tuple[str, str, str]] = []
    for md_file in md_files:
        content = await read_vault_file(f"{folder}/{md_file.name}")
        if content is None:
            continue
        title = _extract_title(content) or md_file.stem.replace("-", " ").title()
        summary = ""
        if summaries and md_file.name in summaries:
            summary = summaries[md_file.name]
        else:
            summary = _extract_first_sentence(content)
        entries.append((title, md_file.name, summary))

    entries.sort(key=lambda e: e[0].lower())

    existing_index = await read_vault_file(f"{folder}/_index.md")
    index_created = source_date
    if existing_index is not None:
        existing_created = extract_created_date(existing_index)
        if existing_created is not None:
            index_created = date.fromisoformat(existing_created)

    folder_label = folder.replace("/", "").title()
    index_frontmatter = build_frontmatter(
        file_type="index",
        tags=[folder.rstrip("/")],
        created=index_created,
        updated=source_date,
    )

    lines = [index_frontmatter, f"\n# {folder_label} Index\n"]
    for title, fname, summary in entries:
        if summary:
            lines.append(f"- [{title}]({fname}) -- {summary}")
        else:
            lines.append(f"- [{title}]({fname})")
    lines.append("")

    index_content = "\n".join(lines)
    index_path = f"{folder}/_index.md"
    await write_vault_file(index_path, index_content)

    log.info("vault_updater.index.regenerated", folder=folder, entry_count=len(entries))
    return {"path": index_path, "action": "rewrite"}


async def update_vault_folders(
    vault_updates: dict[str, list[dict[str, Any]]],
    source_date: date,
) -> list[dict[str, str]]:
    files_modified: list[dict[str, str]] = []

    for folder in VAULT_FOLDERS:
        folder_entries = vault_updates.get(folder, [])
        if not folder_entries:
            continue

        summaries: dict[str, str] = {}
        for entry in folder_entries:
            try:
                result = await write_vault_folder_file(folder, entry, source_date)
                files_modified.append(result)
                summaries[entry["filename"]] = entry.get("summary", "")
            except Exception as exc:
                log.error(
                    "vault_updater.file.failed",
                    folder=folder,
                    filename=entry.get("filename", "unknown"),
                    error=str(exc),
                )

        try:
            index_result = await regenerate_index(folder, source_date, summaries)
            files_modified.append(index_result)
        except Exception as exc:
            log.error(
                "vault_updater.index.failed",
                folder=folder,
                error=str(exc),
            )

    return files_modified


async def update_file_manifest(files_modified: list[dict[str, str]]) -> None:
    try:
        async with async_session_factory() as session:
            for file_entry in files_modified:
                file_path = file_entry["path"]
                content = await read_vault_file(file_path)
                if content is None:
                    continue

                content_hash = _compute_file_hash(content)
                file_size = len(content.encode("utf-8"))

                result = await session.execute(
                    select(FileManifest).where(FileManifest.file_path == file_path)
                )
                existing = result.scalar_one_or_none()

                if existing is not None:
                    existing.content_hash = content_hash
                    existing.file_size = file_size
                else:
                    session.add(
                        FileManifest(
                            file_path=file_path,
                            content_hash=content_hash,
                            file_size=file_size,
                        )
                    )

            await session.commit()

        log.info(
            "vault_updater.manifest.updated",
            file_count=len(files_modified),
        )
    except Exception as exc:
        log.warning(
            "vault_updater.manifest.failed",
            error=str(exc),
        )
