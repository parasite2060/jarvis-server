from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class WeeklyReviewPayload:
    week_start: str  # ISO date YYYY-MM-DD (Monday of the review week)
    trigger: str = "auto"


@dataclass
class WeeklyReviewResult:
    dream_id: int
    pr_url: str | None = None


# --- gather_dailys ---


@dataclass
class GatherDailysResult:
    dream_id: int
    week_start: str  # ISO date passed through
    daily_logs: dict[str, str]  # date string -> content


# --- gather_indexes ---


@dataclass
class GatherIndexesInput:
    dream_id: int
    week_start: str


@dataclass
class GatherIndexesResult:
    vault_indexes: dict[str, str]  # folder name -> _index.md content
    vault_guide: str


# --- run_weekly_review_agent ---


@dataclass
class AgentInput:
    dream_id: int
    week_start: str  # ISO date, used to derive week_number
    daily_logs: dict[str, str]
    vault_indexes: dict[str, str]
    vault_guide: str


@dataclass
class AgentResult:
    review_content: str
    week_themes: list[str] = field(default_factory=list)
    stale_action_items: list[str] = field(default_factory=list)
    project_updates: dict[str, Any] = field(default_factory=dict)
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None
    tool_calls: int | None = None


# --- write_review_file ---


@dataclass
class WriteReviewInput:
    dream_id: int
    week_start: str  # ISO date, used to derive week_number and path
    review_content: str


@dataclass
class WriteReviewResult:
    review_path: str  # e.g. reviews/2026-W18.md
    files_modified: list[dict[str, str]] = field(default_factory=list)


# --- commit_and_pr ---


@dataclass
class WeeklyCommitAndPRInput:
    dream_id: int
    week_iso: str  # YYYY-Www string used for branch name and PR title
    files_modified: list[dict[str, str]] = field(default_factory=list)


@dataclass
class CommitAndPRResult:
    git_branch: str
    git_pr_url: str
    git_pr_status: str
