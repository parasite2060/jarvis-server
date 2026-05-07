from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


@dataclass
class DeepDreamPayload:
    target_date: str  # ISO format: YYYY-MM-DD
    trigger: str = "auto"
    source_date_iso: str | None = None


@dataclass
class DeepDreamResult:
    dream_id: int
    status: Literal["completed", "partial", "skipped"]
    pr_url: str | None = None
    error_message: str | None = None


# --- gather_inputs ---

@dataclass
class GatherInputsResult:
    dream_id: int
    memu_memories: list[dict[str, Any]]
    memory_md: str
    daily_log: str
    soul_md: str
    source_date_iso: str  # resolved target date


# --- phase1_light_sleep ---

@dataclass
class Phase1Input:
    dream_id: int
    memu_memories: list[dict[str, Any]]
    memory_md: str
    daily_log: str
    soul_md: str
    source_date_iso: str


@dataclass
class LightSleepResult:
    candidates_json: list[dict[str, Any]]
    duplicates_removed: int
    contradictions_found: int


# --- score_candidates ---

@dataclass
class ScoringInput:
    dream_id: int
    candidates_json: list[dict[str, Any]]


@dataclass
class ScoredCandidatesResult:
    # List of {content, score, ...candidate_fields}
    scored: list[dict[str, Any]]


# --- phase2_rem_sleep ---

@dataclass
class Phase2Input:
    dream_id: int
    source_date_iso: str
    candidates_json: list[dict[str, Any]]
    scored_json: list[dict[str, Any]]


@dataclass
class REMSleepResult:
    # Serialized REMSleepOutput; None means soft-fail
    output_json: dict[str, Any] | None


# --- phase3_deep_sleep ---

@dataclass
class Phase3Input:
    dream_id: int
    source_date_iso: str
    memu_memories: list[dict[str, Any]]
    memory_md: str
    daily_log: str
    soul_md: str
    phase1_summary: str
    phase2_summary: str


@dataclass
class ConsolidationResult:
    consolidation_json: dict[str, Any]
    messages_json: list[dict[str, Any]]
    usage_input_tokens: int | None
    usage_output_tokens: int | None
    usage_total_tokens: int | None
    usage_tool_calls: int | None


# --- health_check ---

@dataclass
class HealthCheckInput:
    dream_id: int
    source_date_iso: str
    knowledge_gap_names: list[str]


@dataclass
class HealthReportResult:
    # Serialized HealthReport
    report_json: dict[str, Any]
    total_issues: int


# --- health_fix ---

@dataclass
class HealthFixInput:
    dream_id: int
    source_date_iso: str
    memu_memories: list[dict[str, Any]]
    memory_md: str
    daily_log: str
    soul_md: str
    phase1_summary: str
    phase2_summary: str
    consolidation_messages_json: list[dict[str, Any]]


@dataclass
class HealthFixResult:
    status: Literal["clean", "fixed", "incomplete"]
    # Final health report after the loop
    report_json: dict[str, Any]
    total_issues_remaining: int


# --- write_files ---

@dataclass
class WriteFilesInput:
    dream_id: int
    source_date_iso: str
    consolidation_json: dict[str, Any]


@dataclass
class WriteFilesResult:
    files_modified: list[dict[str, str]]


# --- commit_and_pr ---

@dataclass
class DeepCommitAndPRInput:
    dream_id: int
    target_date_iso: str  # used for deterministic branch name
    files_modified: list[dict[str, str]]
    stats: dict[str, Any] = field(default_factory=dict)


@dataclass
class CommitAndPRResult:
    git_branch: str
    git_pr_url: str
    git_pr_status: str


# --- align_memu ---

@dataclass
class AlignMemuInput:
    dream_id: int
    memory_md: str
    source_date_iso: str
    idempotency_key: str  # f"dream-{dream_id}"


# --- invalidate_cache ---

@dataclass
class InvalidateCacheInput:
    dream_id: int
