import asyncio
import os
import tempfile
from datetime import UTC, datetime
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


def _write_text_atomic(path: Path, content: str) -> None:
    parent = path.parent
    parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path_str = tempfile.mkstemp(dir=str(parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        Path(tmp_path_str).replace(path)
    except Exception:
        Path(tmp_path_str).unlink(missing_ok=True)
        raise


def _count_lines(path: Path) -> int:
    if not path.is_file():
        return 0
    return len(path.read_text(encoding="utf-8").splitlines())


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


read_vault_file_raw = read_vault_file


async def read_vault_file_lines(relative_path: str, max_lines: int) -> str | None:
    content = await read_vault_file(relative_path)
    if content is None:
        return None

    lines = content.splitlines()[:max_lines]
    return "\n".join(lines)


async def write_vault_file(relative_path: str, content: str) -> None:
    repo_root = Path(settings.ai_memory_repo_path)
    resolved = safe_resolve(repo_root, relative_path)
    if resolved is None:
        log.warning("memory_files.write.path_traversal", path=relative_path)
        msg = f"Path traversal blocked: {relative_path}"
        raise ValueError(msg)

    await asyncio.to_thread(_write_text_atomic, resolved, content)
    log.debug("memory_files.write.success", path=relative_path, length=len(content))


async def append_vault_file(relative_path: str, content: str) -> None:
    existing = await read_vault_file(relative_path)
    new_content = (existing or "") + content
    await write_vault_file(relative_path, new_content)


ALLOWED_LOG_ACTIONS = (
    "ingest", "reinforce", "create", "update",
    "promote", "contradict", "prune", "lint", "review",
)


async def append_vault_log(action: str, description: str) -> None:
    """Append a timestamped entry to vault-root log.md (append-only)."""
    if action not in ALLOWED_LOG_ACTIONS:
        log.warning("memory_files.vault_log.invalid_action", action=action)
        return
    now = datetime.now(UTC)
    header_line = f"\n## {now.strftime('%Y-%m-%d %H:%M')}\n"
    entry = f"- [{action}] {description}\n"
    await append_vault_file("log.md", header_line + entry)


async def ensure_vault_dir(relative_path: str) -> None:
    repo_root = Path(settings.ai_memory_repo_path)
    resolved = safe_resolve(repo_root, relative_path)
    if resolved is None:
        log.warning("memory_files.ensure_dir.path_traversal", path=relative_path)
        msg = f"Path traversal blocked: {relative_path}"
        raise ValueError(msg)

    await asyncio.to_thread(resolved.parent.mkdir, parents=True, exist_ok=True)


async def count_vault_file_lines(relative_path: str) -> int:
    repo_root = Path(settings.ai_memory_repo_path)
    resolved = safe_resolve(repo_root, relative_path)
    if resolved is None:
        return 0

    return await asyncio.to_thread(_count_lines, resolved)
