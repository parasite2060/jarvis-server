from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class LightDreamPayload:
    transcript_id: int
    session_id: str


@dataclass
class LightDreamResult:
    dream_id: int
    pr_url: str | None = None


@dataclass
class LoadTranscriptResult:
    dream_id: int
    transcript_id: int
    session_id: str
    parsed_text: str
    project: str | None
    token_count: int | None
    is_continuation: bool
    segment_end_line: int
    created_at_iso: str | None


@dataclass
class ExtractionInput:
    dream_id: int
    transcript_id: int
    session_id: str
    parsed_text: str
    project: str | None
    token_count: int | None
    transcript_file: str


@dataclass
class ExtractionAgentOutput:
    summary: str
    no_extract: bool
    # Serialized as JSON-safe dict (str keys, JSON-primitive values)
    session_log_json: dict[str, Any]
    input_tokens: int | None
    output_tokens: int | None
    total_tokens: int | None
    tool_calls: int | None


@dataclass
class PersistSessionLogInput:
    dream_id: int
    session_log_json: dict[str, Any]


@dataclass
class RecordInput:
    dream_id: int
    transcript_id: int
    session_id: str
    summary: str
    session_log_json: dict[str, Any]
    is_continuation: bool
    source_date_iso: str
    session_start_iso: str | None


@dataclass
class FileModified:
    path: str
    action: str


@dataclass
class RecordAgentOutput:
    files_modified: list[FileModified]
    summary: str
    source_date_iso: str


@dataclass
class UpdatePositionInput:
    transcript_id: int
    segment_end_line: int


@dataclass
class CommitAndPRInput:
    session_id: str
    dream_id: int
    files_modified: list[FileModified]
    source_date_iso: str
    extraction_summary: str


@dataclass
class CommitAndPRResult:
    git_branch: str
    git_pr_url: str
    git_pr_status: str


@dataclass
class InvalidateCacheInput:
    dream_id: int
