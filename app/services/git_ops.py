import asyncio
import json
from collections.abc import Callable
from datetime import UTC, date, datetime
from pathlib import Path

import yaml
from sqlalchemy import select

from app.config import settings
from app.core.exceptions import GitOpsError
from app.core.logging import get_logger
from app.models.config_schemas import DEFAULT_DEEP_DREAM_CRON
from app.models.db import async_session_factory
from app.models.tables import DreamPhase

log = get_logger("jarvis.services.git_ops")

_NOTES_TRUNCATE_LIMIT = 120


def _format_phase_notes(error_message: str | None) -> str:
    if not error_message:
        return ""
    text = error_message.replace("\n", " ").replace("|", "\\|").strip()
    if len(text) > _NOTES_TRUNCATE_LIMIT:
        return text[:_NOTES_TRUNCATE_LIMIT] + "…"
    return text


def _format_phase_label(phase: str, output_json: dict | None) -> str:
    if phase == "health_fix" and isinstance(output_json, dict):
        iteration = output_json.get("iteration")
        if iteration is not None:
            return f"health_fix (iter {iteration})"
    return phase


def _format_phase_status(status: str) -> str:
    return status if status == "completed" else f"**{status.upper()}**"


def _format_phase_duration(duration_ms: int | None) -> str:
    if duration_ms is None:
        return ""
    return f"{round(duration_ms / 1000)}s"


def _render_phase_status_section(phases: list[DreamPhase]) -> str:
    if not phases:
        return ""
    lines: list[str] = [
        "",
        "## Phase status",
        "",
        "| Phase | Status | Duration | Notes |",
        "|---|---|---|---|",
    ]
    for row in phases:
        label = _format_phase_label(row.phase, row.output_json)
        status = _format_phase_status(row.status)
        duration = _format_phase_duration(row.duration_ms)
        notes = _format_phase_notes(row.error_message) if row.status != "completed" else ""
        lines.append(f"| {label} | {status} | {duration} | {notes} |")
    return "\n".join(lines)


async def _fetch_dream_phases(dream_id: int) -> list[DreamPhase]:
    async with async_session_factory() as session:
        result = await session.execute(
            select(DreamPhase).where(DreamPhase.dream_id == dream_id).order_by(DreamPhase.id)
        )
        return list(result.scalars().all())


DEFAULT_DREAM_CONFIG: dict[str, object] = {
    "auto_merge": True,
    "deep_dream_cron": DEFAULT_DEEP_DREAM_CRON,
    "max_memory_lines": 200,
}


class GitOpsService:
    def __init__(self) -> None:
        self._last_pull_at: datetime | None = None
        self._on_config_change: Callable[[], None] | None = None

    def set_config_change_callback(self, callback: Callable[[], None]) -> None:
        self._on_config_change = callback

    async def read_dream_config(self) -> dict[str, object]:
        config_path = Path(settings.ai_memory_repo_path) / "config.yml"
        try:
            content = await asyncio.to_thread(config_path.read_text, encoding="utf-8")
            parsed: dict[str, object] = yaml.safe_load(content) or {}
            return {
                "auto_merge": parsed.get("auto_merge", True),
                "deep_dream_cron": parsed.get("deep_dream_cron", DEFAULT_DEEP_DREAM_CRON),
                "max_memory_lines": parsed.get("max_memory_lines", 200),
            }
        except Exception:
            log.warning("git_ops.config.read_failed", path=str(config_path))
            return dict(DEFAULT_DREAM_CONFIG)

    async def run_git(self, args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
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

    async def run_gh(self, args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
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

    async def pull_latest_main(self) -> None:
        try:
            await self.run_git(["checkout", "main"])
            await self.run_git(["pull", "origin", "main"])
            self._last_pull_at = datetime.now(UTC)
            log.info("git_ops.pull.completed")
            if self._on_config_change:
                self._on_config_change()
        except GitOpsError as exc:
            log.warning("git_ops.pull.failed", error=str(exc))

    async def ensure_main_fresh(self, max_age_seconds: int = 1800) -> None:
        if self._last_pull_at is not None:
            age = (datetime.now(UTC) - self._last_pull_at).total_seconds()
            if age < max_age_seconds:
                log.info("git_ops.pull.skipped_fresh", age_seconds=int(age))
                return
        await self.pull_latest_main()

    async def create_light_dream_pr(
        self,
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
            str(entry["path"])
            for entry in files_modified
            if "path" in entry and "error" not in entry
        ]

        if not file_paths:
            return {"git_branch": "", "git_pr_url": "", "git_pr_status": "no_files"}

        config = await self.read_dream_config()
        auto_merge = bool(config.get("auto_merge", True))

        await self.ensure_main_fresh()

        # Create branch from origin/main
        await self.run_git(["checkout", "-b", branch_name, "origin/main"])
        log.info("git_ops.branch.created", branch=branch_name)

        # Stage specific files only
        await self.run_git(["add"] + file_paths)

        # Check if there are staged changes
        try:
            await self.run_git(["diff", "--cached", "--quiet"])
            log.info("git_ops.no_changes", branch=branch_name)
            return {"git_branch": branch_name, "git_pr_url": "", "git_pr_status": "no_changes"}
        except GitOpsError:
            pass

        # Commit
        await self.run_git(["commit", "-m", commit_msg])
        log.info("git_ops.commit.created", branch=branch_name)

        # Push
        await self.run_git(["push", "origin", branch_name])
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
        pr_stdout, _, _ = await self.run_gh(
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

        if auto_merge:
            try:
                await self.run_gh(["pr", "merge", "--squash", "--delete-branch", pr_url])
                pr_status = "merged"
                log.info("git_ops.pr.merged", pr_url=pr_url)
            except GitOpsError as exc:
                log.warning("git_ops.pr.merge_failed", pr_url=pr_url, error=str(exc))

        return {
            "git_branch": branch_name,
            "git_pr_url": pr_url,
            "git_pr_status": pr_status,
        }

    async def create_deep_dream_pr(
        self,
        files_modified: list[dict[str, object]],
        dream_id: int,
        source_date: date,
        stats: dict[str, object] | None = None,
    ) -> dict[str, str]:
        date_str = source_date.isoformat()
        branch_name = f"dream/deep-{date_str}"
        commit_msg = f"dream(deep): consolidate {date_str}"
        pr_title = f"dream(deep): consolidate {date_str}"

        file_paths = [
            str(entry["path"])
            for entry in files_modified
            if "path" in entry and "error" not in entry
        ]

        if not file_paths:
            log.info("git_ops.deep_pr.no_files", dream_id=dream_id)
            return {"git_branch": "", "git_pr_url": "", "git_pr_status": "no_files"}

        config = await self.read_dream_config()
        auto_merge = bool(config.get("auto_merge", True))

        await self.ensure_main_fresh()

        # Handle branch-already-exists by appending suffix
        try:
            await self.run_git(["checkout", "-b", branch_name, "origin/main"])
        except GitOpsError:
            suffix = 2
            while suffix <= 10:
                candidate = f"{branch_name}-{suffix}"
                try:
                    await self.run_git(["checkout", "-b", candidate, "origin/main"])
                    branch_name = candidate
                    break
                except GitOpsError:
                    suffix += 1
            else:
                raise GitOpsError(f"Could not create branch {branch_name} (all suffixes taken)")

        log.info("git_ops.deep_pr.branch_created", branch=branch_name)

        # Stage specific files only
        await self.run_git(["add"] + file_paths)

        # Check if there are staged changes
        try:
            await self.run_git(["diff", "--cached", "--quiet"])
            log.info("git_ops.deep_pr.no_changes", branch=branch_name)
            return {"git_branch": branch_name, "git_pr_url": "", "git_pr_status": "no_changes"}
        except GitOpsError:
            pass

        # Commit
        await self.run_git(["commit", "-m", commit_msg])
        log.info("git_ops.deep_pr.committed", branch=branch_name)

        # Push
        await self.run_git(["push", "origin", branch_name])
        log.info("git_ops.deep_pr.pushed", branch=branch_name)

        # Build PR body
        stats_section = ""
        if stats:
            stats_section = (
                "\n### Consolidation Stats\n"
                f"- Duplicates removed: {stats.get('duplicates_removed', 0)}\n"
                f"- Contradictions resolved: {stats.get('contradictions_resolved', 0)}\n"
                f"- Patterns promoted: {stats.get('patterns_promoted', 0)}\n"
                f"- Stale pruned: {stats.get('stale_pruned', 0)}\n"
            )

        try:
            phase_rows = await _fetch_dream_phases(dream_id)
            phase_status_section = _render_phase_status_section(phase_rows)
        except Exception as exc:
            log.warning(
                "git_ops.deep_pr.phase_status_fetch_failed",
                dream_id=dream_id,
                error=str(exc),
            )
            phase_status_section = ""

        pr_body = (
            f"## Deep Dream Consolidation\n\n"
            f"**Dream ID:** {dream_id}\n"
            f"**Date:** {date_str}\n\n"
            f"### Changed Files\n"
            + "\n".join(f"- `{p}`" for p in file_paths)
            + f"\n\n**Total:** {len(file_paths)} file(s) modified"
            + stats_section
            + phase_status_section
        )

        # Create PR
        pr_stdout, _, _ = await self.run_gh(
            ["pr", "create", "--title", pr_title, "--body", pr_body, "--base", "main"]
        )
        pr_url = pr_stdout.strip()
        log.info("git_ops.deep_pr.created", pr_url=pr_url)

        pr_status = "created"

        if auto_merge:
            try:
                await self.run_gh(["pr", "merge", "--squash", "--delete-branch", pr_url])
                pr_status = "merged"
                log.info("git_ops.deep_pr.merged", pr_url=pr_url)
            except GitOpsError as exc:
                log.warning("git_ops.deep_pr.merge_failed", pr_url=pr_url, error=str(exc))

        return {
            "git_branch": branch_name,
            "git_pr_url": pr_url,
            "git_pr_status": pr_status,
        }

    async def create_weekly_review_pr(
        self,
        files_modified: list[dict[str, object]],
        dream_id: int,
        week_number: str,
        source_date: date,
    ) -> dict[str, str]:
        branch_name = f"dream/review-{week_number}"
        commit_msg = f"dream(review): weekly review {week_number}"
        pr_title = f"dream(review): weekly review {week_number}"

        file_paths = [
            str(entry["path"])
            for entry in files_modified
            if "path" in entry and "error" not in entry
        ]

        if not file_paths:
            log.info("git_ops.weekly_review_pr.no_files", dream_id=dream_id)
            return {"git_branch": "", "git_pr_url": "", "git_pr_status": "no_files"}

        config = await self.read_dream_config()
        auto_merge = bool(config.get("auto_merge", True))

        await self.ensure_main_fresh()

        try:
            await self.run_git(["checkout", "-b", branch_name, "origin/main"])
        except GitOpsError:
            suffix = 2
            while suffix <= 10:
                candidate = f"{branch_name}-{suffix}"
                try:
                    await self.run_git(["checkout", "-b", candidate, "origin/main"])
                    branch_name = candidate
                    break
                except GitOpsError:
                    suffix += 1
            else:
                raise GitOpsError(f"Could not create branch {branch_name} (all suffixes taken)")

        log.info("git_ops.weekly_review_pr.branch_created", branch=branch_name)

        await self.run_git(["add"] + file_paths)

        try:
            await self.run_git(["diff", "--cached", "--quiet"])
            log.info("git_ops.weekly_review_pr.no_changes", branch=branch_name)
            return {"git_branch": branch_name, "git_pr_url": "", "git_pr_status": "no_changes"}
        except GitOpsError:
            pass

        await self.run_git(["commit", "-m", commit_msg])
        log.info("git_ops.weekly_review_pr.committed", branch=branch_name)

        await self.run_git(["push", "origin", branch_name])
        log.info("git_ops.weekly_review_pr.pushed", branch=branch_name)

        pr_body = (
            f"## Weekly Review\n\n"
            f"**Dream ID:** {dream_id}\n"
            f"**Week:** {week_number}\n"
            f"**Date:** {source_date.isoformat()}\n\n"
            f"### Changed Files\n"
            + "\n".join(f"- `{p}`" for p in file_paths)
            + f"\n\n**Total:** {len(file_paths)} file(s) modified"
        )

        pr_stdout, _, _ = await self.run_gh(
            ["pr", "create", "--title", pr_title, "--body", pr_body, "--base", "main"]
        )
        pr_url = pr_stdout.strip()
        log.info("git_ops.weekly_review_pr.created", pr_url=pr_url)

        pr_status = "created"

        if auto_merge:
            try:
                await self.run_gh(["pr", "merge", "--squash", "--delete-branch", pr_url])
                pr_status = "merged"
                log.info("git_ops.weekly_review_pr.merged", pr_url=pr_url)
            except GitOpsError as exc:
                log.warning("git_ops.weekly_review_pr.merge_failed", pr_url=pr_url, error=str(exc))

        return {
            "git_branch": branch_name,
            "git_pr_url": pr_url,
            "git_pr_status": pr_status,
        }

    async def cleanup_branch(self, branch_name: str) -> None:
        try:
            await self.run_git(["checkout", "main"])
        except Exception as exc:
            log.warning("git_ops.cleanup_failed", branch=branch_name, error=str(exc))

    async def cleanup_merged_branches(self) -> dict[str, object]:
        log.info("git_ops.cleanup.started")

        try:
            await self.run_git(["checkout", "main"])
        except GitOpsError as exc:
            log.warning("git_ops.cleanup.checkout_failed", error=str(exc))
            return {"deleted_local": 0, "pruned_remote": False}

        # List dream branches
        try:
            stdout, _, _ = await self.run_git(["branch", "--list", "dream/*"])
        except GitOpsError:
            stdout = ""
        dream_branches = [b.strip().lstrip("* ") for b in stdout.splitlines() if b.strip()]

        # List branches merged into main
        try:
            merged_stdout, _, _ = await self.run_git(["branch", "--merged", "main"])
        except GitOpsError:
            merged_stdout = ""
        merged = {b.strip().lstrip("* ") for b in merged_stdout.splitlines() if b.strip()}

        # Delete merged dream branches
        deleted = 0
        for branch in dream_branches:
            if branch in merged and branch != "main":
                try:
                    await self.run_git(["branch", "-d", branch])
                    deleted += 1
                    log.info("git_ops.cleanup.branch_deleted", branch=branch)
                except GitOpsError as exc:
                    log.warning(
                        "git_ops.cleanup.branch_delete_failed",
                        branch=branch,
                        error=str(exc),
                    )

        # Prune stale remote tracking refs
        pruned = False
        try:
            await self.run_git(["remote", "prune", "origin"])
            pruned = True
        except GitOpsError as exc:
            log.warning("git_ops.cleanup.prune_failed", error=str(exc))

        log.info("git_ops.cleanup.completed", deleted_local=deleted, pruned_remote=pruned)
        return {"deleted_local": deleted, "pruned_remote": pruned}

    async def get_pr_status(self, pr_url: str) -> dict[str, object]:
        if not pr_url:
            return {"state": "unknown", "error": "empty_url"}

        try:
            stdout, _, _ = await self.run_gh(
                ["pr", "view", pr_url, "--json", "state,mergedAt,closedAt,title"]
            )
            data = json.loads(stdout)
            log.info("git_ops.pr_status.checked", pr_url=pr_url, state=data.get("state"))
            return {
                "state": data.get("state", "unknown"),
                "merged_at": data.get("mergedAt"),
                "closed_at": data.get("closedAt"),
                "title": data.get("title", ""),
            }
        except (GitOpsError, json.JSONDecodeError) as exc:
            log.warning("git_ops.pr_status.failed", pr_url=pr_url, error=str(exc))
            return {"state": "unknown", "error": str(exc)}


# Module-level singleton for backward-compatible imports
git_ops_service = GitOpsService()
