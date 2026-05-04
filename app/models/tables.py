from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.db import Base

SCHEMA = "jarvis"

DREAM_OUTCOMES = (
    "wrote_files",
    "no_new_content",
    "extraction_empty",
    "record_soft_fail",
    "extraction_under_yield",
)


class DreamPhase(Base):
    __tablename__ = "dream_phases"
    __table_args__ = (
        Index("ix_dream_phases_dream_id", "dream_id"),
        Index("ix_dream_phases_phase", "phase"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    dream_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(f"{SCHEMA}.dreams.id"), nullable=False
    )
    phase: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="processing")

    run_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    output_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    conversation_history: Mapped[list | None] = mapped_column(JSONB, nullable=True)

    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tool_calls: Mapped[int | None] = mapped_column(Integer, nullable=True)

    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Transcript(Base):
    __tablename__ = "transcripts"
    __table_args__ = (
        Index("ix_transcripts_session_id", "session_id"),
        Index("ix_transcripts_status", "status"),
        Index("ix_transcripts_created_at", "created_at"),
        Index("ix_transcripts_session_source", "session_id", "source"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String(255), nullable=False)
    project: Mapped[str | None] = mapped_column(String(255), nullable=True)
    raw_content: Mapped[str] = mapped_column(Text, nullable=False)
    parsed_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source: Mapped[str | None] = mapped_column(String(50), nullable=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="received")
    light_dream_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey(f"{SCHEMA}.dreams.id"), nullable=True
    )
    is_continuation: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    segment_start_line: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    segment_end_line: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    last_processed_line: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Dream(Base):
    __tablename__ = "dreams"
    __table_args__ = (
        Index("ix_dreams_type", "type"),
        Index("ix_dreams_status", "status"),
        Index("ix_dreams_created_at", "created_at"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    trigger: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="queued")
    outcome: Mapped[str | None] = mapped_column(String(30), nullable=True)
    transcript_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey(f"{SCHEMA}.transcripts.id"), nullable=True
    )
    input_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    output_raw: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Full SessionLogEntry (9 keys, incl. memories=list[MemoryItem]) for light dreams.
    # NULL for deep / weekly / failed / skipped / no_extract dreams.
    session_log: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # type: ignore[type-arg]
    files_modified: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # type: ignore[type-arg]
    git_branch: Mapped[str | None] = mapped_column(String(255), nullable=True)
    git_pr_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    git_pr_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tool_calls: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class FileManifest(Base):
    __tablename__ = "file_manifest"
    __table_args__ = (
        Index("ix_file_manifest_file_path", "file_path", unique=True),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    file_path: Mapped[str] = mapped_column(String(500), unique=True, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ContextCache(Base):
    __tablename__ = "context_cache"
    __table_args__ = (
        Index("ix_context_cache_cache_key", "cache_key", unique=True),
        Index("ix_context_cache_expires_at", "expires_at"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    cache_key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
