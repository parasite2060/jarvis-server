from __future__ import annotations

import asyncio
import os
import tempfile
from datetime import date
from pathlib import Path

from temporalio import activity

from app.activities.weekly._models import WriteReviewInput, WriteReviewResult
from app.config import settings


def _week_number(week_start_iso: str) -> str:
    d = date.fromisoformat(week_start_iso)
    iso_year, iso_week, _ = d.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


def _build_review_frontmatter(week_start_iso: str, week_num: str) -> str:
    return (
        "---\n"
        "type: review\n"
        "tags: [review, weekly]\n"
        f"created: {week_start_iso}\n"
        f"week: {week_num}\n"
        "---\n"
    )


def _write_atomic(path: Path, content: str) -> None:
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


@activity.defn(name="weekly.write_review_file")
async def write_review_file(inp: WriteReviewInput) -> WriteReviewResult:
    week_num = _week_number(inp.week_start)
    review_path = f"reviews/{week_num}.md"

    frontmatter = _build_review_frontmatter(inp.week_start, week_num)
    review_full = frontmatter + inp.review_content

    repo_root = Path(settings.ai_memory_repo_path)
    full_path = repo_root / review_path

    await asyncio.to_thread(_write_atomic, full_path, review_full)

    files_modified = [{"path": review_path, "action": "create"}]
    activity.logger.info("weekly.write_review_file.completed", path=review_path)
    return WriteReviewResult(review_path=review_path, files_modified=files_modified)
