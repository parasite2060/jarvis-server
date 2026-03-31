import asyncio
from datetime import date
from pathlib import Path

import yaml

from app.config import settings
from app.core.exceptions import GitOpsError
from app.core.logging import get_logger

log = get_logger("jarvis.services.git_ops")

DEFAULT_DREAM_CONFIG: dict[str, object] = {
    "auto_merge": True,
    "max_memory_lines": 200,
}


async def read_dream_config() -> dict[str, object]:
    config_path = Path(settings.ai_memory_repo_path) / "config.yml"
    try:
        content = await asyncio.to_thread(config_path.read_text, encoding="utf-8")
        parsed: dict[str, object] = yaml.safe_load(content) or {}
        return {
            "auto_merge": parsed.get("auto_merge", True),
            "max_memory_lines": parsed.get("max_memory_lines", 200),
        }
    except Exception:
        log.warning("git_ops.config.read_failed", path=str(config_path))
        return dict(DEFAULT_DREAM_CONFIG)


async def run_git(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
    repo_path = cwd or settings.ai_memory_repo_path
    proc = await asyncio.create_subprocess_exec(
        "git",
        *args,
        cwd=repo_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout_bytes, stderr_bytes = await proc.communicate()
    stdout = stdout_bytes.decode().strip() if stdout_bytes else ""
    stderr = stderr_bytes.decode().strip() if stderr_bytes else ""
    returncode = proc.returncode or 0
    log.info("git_ops.command", args=args[:2], returncode=returncode)
    if returncode != 0:
        raise GitOpsError(f"git {' '.join(args[:2])} failed (rc={returncode}): {stderr}")
    return stdout, stderr, returncode


async def run_gh(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
    repo_path = cwd or settings.ai_memory_repo_path
    proc = await asyncio.create_subprocess_exec(
        "gh",
        *args,
        cwd=repo_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout_bytes, stderr_bytes = await proc.communicate()
    stdout = stdout_bytes.decode().strip() if stdout_bytes else ""
    stderr = stderr_bytes.decode().strip() if stderr_bytes else ""
    returncode = proc.returncode or 0
    log.info("git_ops.gh_command", args=args[:2], returncode=returncode)
    if returncode != 0:
        raise GitOpsError(f"gh {' '.join(args[:2])} failed (rc={returncode}): {stderr}")
    return stdout, stderr, returncode


async def create_dream_pr(
    files_modified: list[dict[str, object]],
    dream_id: int,
    source_date: date,
    source_time: str,
) -> dict[str, str]:
    branch_name = f"dream/light-{source_date.isoformat()}-{source_time}"
    time_formatted = f"{source_time[:2]}:{source_time[2:4]}"
    commit_msg = f"dream(light): extract session {source_date.isoformat()} {time_formatted}"
    pr_title = f"dream(light): extract session {source_date.isoformat()}"

    file_paths = [
        str(entry["path"]) for entry in files_modified if "path" in entry and "error" not in entry
    ]

    if not file_paths:
        return {"git_branch": "", "git_pr_url": "", "git_pr_status": "no_files"}

    config = await read_dream_config()
    auto_merge = bool(config.get("auto_merge", True))

    # Fetch latest main
    await run_git(["fetch", "origin", "main"])
    log.info("git_ops.fetch.completed")

    # Create branch from origin/main
    await run_git(["checkout", "-b", branch_name, "origin/main"])
    log.info("git_ops.branch.created", branch=branch_name)

    # Stage specific files only
    await run_git(["add"] + file_paths)

    # Check if there are staged changes
    try:
        await run_git(["diff", "--cached", "--quiet"])
        # Exit code 0 means no changes — skip commit
        log.info("git_ops.no_changes", branch=branch_name)
        return {"git_branch": branch_name, "git_pr_url": "", "git_pr_status": "no_changes"}
    except GitOpsError:
        # Exit code 1 means changes exist — proceed
        pass

    # Commit
    await run_git(["commit", "-m", commit_msg])
    log.info("git_ops.commit.created", branch=branch_name)

    # Push
    await run_git(["push", "origin", branch_name])
    log.info("git_ops.push.completed", branch=branch_name)

    # Create PR
    pr_body = (
        f"## Dream Light Extract\n\n"
        f"**Dream ID:** {dream_id}\n"
        f"**Date:** {source_date.isoformat()}\n\n"
        f"### Changed Files\n"
        + "\n".join(f"- `{p}`" for p in file_paths)
        + f"\n\n**Memories:** {len(files_modified)} file(s) modified"
    )
    pr_stdout, _, _ = await run_gh(
        [
            "pr",
            "create",
            "--title",
            pr_title,
            "--body",
            pr_body,
            "--base",
            "main",
        ]
    )
    pr_url = pr_stdout.strip()
    log.info("git_ops.pr.created", pr_url=pr_url)

    pr_status = "created"

    # Auto-merge if configured
    if auto_merge:
        await run_gh(["pr", "merge", "--auto", "--squash", "--delete-branch", pr_url])
        pr_status = "auto_merge_enabled"
        log.info("git_ops.pr.auto_merge_enabled", pr_url=pr_url)

    return {
        "git_branch": branch_name,
        "git_pr_url": pr_url,
        "git_pr_status": pr_status,
    }


async def cleanup_branch(branch_name: str) -> None:
    try:
        await run_git(["checkout", "main"])
    except Exception as exc:
        log.warning("git_ops.cleanup_failed", branch=branch_name, error=str(exc))
