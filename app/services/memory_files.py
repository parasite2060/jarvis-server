import asyncio
from pathlib import Path

from app.config import settings
from app.core.logging import get_logger

log = get_logger("jarvis.services.memory_files")


def safe_resolve(repo_root: Path, relative_path: str) -> Path | None:
    resolved = (repo_root / relative_path).resolve()
    if not resolved.is_relative_to(repo_root.resolve()):
        return None
    return resolved


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


async def read_vault_file(relative_path: str) -> str | None:
    repo_root = Path(settings.ai_memory_repo_path)
    resolved = safe_resolve(repo_root, relative_path)
    if resolved is None:
        log.warning("memory_files.read.path_traversal", path=relative_path)
        return None

    if not resolved.is_file():
        log.debug("memory_files.read.not_found", path=relative_path)
        return None

    content = await asyncio.to_thread(_read_text, resolved)
    log.debug("memory_files.read.success", path=relative_path, length=len(content))
    return content


async def read_vault_file_lines(relative_path: str, max_lines: int) -> str | None:
    content = await read_vault_file(relative_path)
    if content is None:
        return None

    lines = content.splitlines()[:max_lines]
    return "\n".join(lines)
