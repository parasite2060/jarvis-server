import asyncio
import hashlib
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import delete, select

from app.config import settings
from app.core.logging import get_logger
from app.models.db import async_session_factory
from app.models.tables import FileManifest

log = get_logger("jarvis.services.file_manifest")

SKIP_DIRS = {".git", "node_modules", "__pycache__"}
VAULT_EXTENSIONS = {".md", ".yml", ".yaml"}


@dataclass
class VaultFileInfo:
    relative_path: str
    content_hash: str
    file_size: int
    updated_at: datetime


def _scan_and_hash(repo_root: Path) -> list[VaultFileInfo]:
    results: list[VaultFileInfo] = []
    for dirpath, dirnames, filenames in os.walk(repo_root):
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and d not in SKIP_DIRS]
        for filename in filenames:
            if filename.startswith("."):
                continue
            filepath = Path(dirpath) / filename
            suffix = filepath.suffix.lower()
            if suffix not in VAULT_EXTENSIONS:
                continue
            relative = filepath.relative_to(repo_root).as_posix()
            content = filepath.read_bytes()
            content_hash = hashlib.sha256(content).hexdigest()
            stat = filepath.stat()
            results.append(
                VaultFileInfo(
                    relative_path=relative,
                    content_hash=content_hash,
                    file_size=len(content),
                    updated_at=datetime.fromtimestamp(stat.st_mtime, tz=UTC),
                )
            )
    return results


async def scan_vault_files() -> list[VaultFileInfo]:
    repo_root = Path(settings.ai_memory_repo_path)
    files = await asyncio.to_thread(_scan_and_hash, repo_root)
    log.info("file_manifest.scan.success", file_count=len(files))
    return files


def compute_manifest_hash(files: list[VaultFileInfo]) -> str:
    entries = sorted(f"{f.relative_path}:{f.content_hash}" for f in files)
    combined = "\n".join(entries)
    return hashlib.sha256(combined.encode()).hexdigest()


@dataclass
class ManifestResult:
    files: list[VaultFileInfo]
    manifest_hash: str
    generated_at: datetime


async def build_manifest() -> ManifestResult:
    files = await scan_vault_files()
    manifest_hash = compute_manifest_hash(files)
    return ManifestResult(
        files=files,
        manifest_hash=manifest_hash,
        generated_at=datetime.now(tz=UTC),
    )


async def sync_file_manifest_to_db(files: list[VaultFileInfo]) -> None:
    try:
        async with async_session_factory() as session:
            async with session.begin():
                result = await session.execute(select(FileManifest))
                existing_rows = result.scalars().all()
                existing_by_path: dict[str, FileManifest] = {
                    row.file_path: row for row in existing_rows
                }

                scanned_paths = {f.relative_path for f in files}

                for file_info in files:
                    existing = existing_by_path.get(file_info.relative_path)
                    if existing is None:
                        session.add(
                            FileManifest(
                                file_path=file_info.relative_path,
                                content_hash=file_info.content_hash,
                                file_size=file_info.file_size,
                            )
                        )
                    elif existing.content_hash != file_info.content_hash:
                        existing.content_hash = file_info.content_hash
                        existing.file_size = file_info.file_size

                removed_paths = set(existing_by_path.keys()) - scanned_paths
                if removed_paths:
                    await session.execute(
                        delete(FileManifest).where(FileManifest.file_path.in_(removed_paths))
                    )

        log.info("file_manifest.db_sync.success", file_count=len(files))
    except Exception as exc:
        log.error("file_manifest.db_sync.error", error=str(exc))
