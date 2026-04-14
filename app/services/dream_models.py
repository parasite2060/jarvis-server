from typing import Literal

from pydantic import BaseModel, Field

ALLOWED_VAULT_TARGETS = (
    "memory",
    "decisions",
    "patterns",
    "projects",
    "templates",
    "concepts",
    "connections",
    "lessons",
    "references",
    "reviews",
)

ALLOWED_RELATIONSHIP_TYPES = (
    "extends",
    "contradicts",
    "supports",
    "inspired_by",
    "supersedes",
    "derived_from",
    "addresses_gap",
)

VaultTarget = Literal[
    "memory",
    "decisions",
    "patterns",
    "projects",
    "templates",
    "concepts",
    "connections",
    "lessons",
    "references",
    "reviews",
]


class MemoryItem(BaseModel):
    content: str = Field(max_length=200)
    reasoning: str | None = None
    vault_target: VaultTarget
    source_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")


class SessionLogEntry(BaseModel):
    context: str = ""
    key_exchanges: list[str] = Field(default_factory=list)
    decisions_made: list[str] = Field(default_factory=list)
    lessons_learned: list[str] = Field(default_factory=list)
    action_items: list[str] = Field(default_factory=list)
    concepts: list[dict[str, str]] = Field(default_factory=list)
    connections: list[dict[str, str]] = Field(default_factory=list)


class ExtractionSummary(BaseModel):
    summary: str = ""
    no_extract: bool = False
    session_log: SessionLogEntry = Field(default_factory=SessionLogEntry)


class FileAction(BaseModel):
    path: str
    action: Literal["create", "append", "update", "skip"]


class RecordResult(BaseModel):
    files: list[FileAction] = Field(default_factory=list)
    summary: str = ""


# Kept for backward compat (deep dream ConsolidationOutput still uses it)
class DreamExtraction(BaseModel):
    no_extract: bool = False
    summary: str = ""
    decisions: list[MemoryItem] = Field(default_factory=list)
    preferences: list[MemoryItem] = Field(default_factory=list)
    patterns: list[MemoryItem] = Field(default_factory=list)
    corrections: list[MemoryItem] = Field(default_factory=list)
    facts: list[MemoryItem] = Field(default_factory=list)


class ConsolidationStats(BaseModel):
    total_memories_processed: int = 0
    duplicates_removed: int = 0
    contradictions_resolved: int = 0
    patterns_promoted: int = 0
    stale_pruned: int = 0


class VaultFileEntry(BaseModel):
    filename: str
    title: str
    summary: str = Field(max_length=100)
    content: str
    tags: list[str] = Field(default_factory=list)
    action: Literal["create", "update"]


class VaultUpdates(BaseModel):
    decisions: list[VaultFileEntry] = Field(default_factory=list)
    projects: list[VaultFileEntry] = Field(default_factory=list)
    patterns: list[VaultFileEntry] = Field(default_factory=list)
    templates: list[VaultFileEntry] = Field(default_factory=list)
    concepts: list[VaultFileEntry] = Field(default_factory=list)
    connections: list[VaultFileEntry] = Field(default_factory=list)
    lessons: list[VaultFileEntry] = Field(default_factory=list)


class ConsolidationOutput(BaseModel):
    memory_md: str
    daily_summary: str
    stats: ConsolidationStats = Field(default_factory=ConsolidationStats)
    vault_updates: VaultUpdates = Field(default_factory=VaultUpdates)


class ScoredCandidate(BaseModel):
    content: str
    category: str
    reinforcement_count: int = 0
    contradiction_flag: bool = False
    source_sessions: list[str] = Field(default_factory=list)


class LightSleepOutput(BaseModel):
    candidates: list[ScoredCandidate] = Field(default_factory=list)
    duplicates_removed: int = 0
    contradictions_found: int = 0


class Theme(BaseModel):
    topic: str
    session_count: int = 0
    evidence: list[str] = Field(default_factory=list)


class ConnectionCandidate(BaseModel):
    concept_a: str
    concept_b: str
    relationship: str
    relationship_type: str = "supports"
    evidence_sessions: list[str] = Field(default_factory=list)


class PromotionCandidate(BaseModel):
    source_file: str
    target_folder: str
    reason: str


class KnowledgeGap(BaseModel):
    concept: str
    mentioned_in_files: list[str] = Field(default_factory=list)


class REMSleepOutput(BaseModel):
    themes: list[Theme] = Field(default_factory=list)
    new_connections: list[ConnectionCandidate] = Field(default_factory=list)
    promotion_candidates: list[PromotionCandidate] = Field(default_factory=list)
    gaps: list[KnowledgeGap] = Field(default_factory=list)


class WeeklyReviewOutput(BaseModel):
    review_content: str = ""
    week_themes: list[str] = Field(default_factory=list)
    stale_action_items: list[str] = Field(default_factory=list)
    project_updates: dict[str, str] = Field(default_factory=dict)


class HealthReport(BaseModel):
    orphan_notes: list[str] = Field(default_factory=list)
    stale_notes: list[str] = Field(default_factory=list)
    missing_frontmatter: list[str] = Field(default_factory=list)
    unresolved_contradictions: list[str] = Field(default_factory=list)
    memory_overflow: bool = False
    knowledge_gaps: list[str] = Field(default_factory=list)
    missing_backlinks: list[str] = Field(default_factory=list)
    total_issues: int = 0
