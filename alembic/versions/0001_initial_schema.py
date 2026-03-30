"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-03-30 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "jarvis"


def upgrade() -> None:
    op.execute(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}")

    op.create_table(
        "dreams",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("type", sa.String(20), nullable=False),
        sa.Column("trigger", sa.String(20), nullable=False),
        sa.Column("status", sa.String(50), nullable=False, server_default="queued"),
        sa.Column("transcript_id", sa.Integer(), nullable=True),
        sa.Column("input_summary", sa.Text(), nullable=True),
        sa.Column("output_raw", sa.Text(), nullable=True),
        sa.Column("memories_extracted", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("files_modified", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("git_branch", sa.String(255), nullable=True),
        sa.Column("git_pr_url", sa.String(500), nullable=True),
        sa.Column("git_pr_status", sa.String(50), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        schema=SCHEMA,
    )
    op.create_index("ix_dreams_type", "dreams", ["type"], schema=SCHEMA)
    op.create_index("ix_dreams_status", "dreams", ["status"], schema=SCHEMA)
    op.create_index("ix_dreams_created_at", "dreams", ["created_at"], schema=SCHEMA)

    op.create_table(
        "transcripts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("session_id", sa.String(255), nullable=False),
        sa.Column("project", sa.String(255), nullable=True),
        sa.Column("raw_content", sa.Text(), nullable=False),
        sa.Column("parsed_text", sa.Text(), nullable=True),
        sa.Column("token_count", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(50), nullable=False, server_default="received"),
        sa.Column("light_dream_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["light_dream_id"], [f"{SCHEMA}.dreams.id"], name="fk_transcripts_light_dream_id"
        ),
        sa.PrimaryKeyConstraint("id"),
        schema=SCHEMA,
    )
    op.create_index("ix_transcripts_session_id", "transcripts", ["session_id"], schema=SCHEMA)
    op.create_index("ix_transcripts_status", "transcripts", ["status"], schema=SCHEMA)
    op.create_index("ix_transcripts_created_at", "transcripts", ["created_at"], schema=SCHEMA)

    op.create_foreign_key(
        "fk_dreams_transcript_id",
        "dreams",
        "transcripts",
        ["transcript_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
    )

    op.create_table(
        "extracted_memories",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("dream_id", sa.Integer(), nullable=False),
        sa.Column("type", sa.String(50), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("reasoning", sa.Text(), nullable=True),
        sa.Column("vault_target", sa.String(50), nullable=True),
        sa.Column("reinforcement", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("source_date", sa.Date(), nullable=False),
        sa.Column("memu_synced", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["dream_id"],
            [f"{SCHEMA}.dreams.id"],
            name="fk_extracted_memories_dream_id",
        ),
        sa.PrimaryKeyConstraint("id"),
        schema=SCHEMA,
    )
    op.create_index("ix_extracted_memories_type", "extracted_memories", ["type"], schema=SCHEMA)
    op.create_index(
        "ix_extracted_memories_vault_target",
        "extracted_memories",
        ["vault_target"],
        schema=SCHEMA,
    )
    op.create_index(
        "ix_extracted_memories_source_date",
        "extracted_memories",
        ["source_date"],
        schema=SCHEMA,
    )

    op.create_table(
        "file_manifest",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("file_path", sa.String(500), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("file_path", name="uq_file_manifest_file_path"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_file_manifest_file_path", "file_manifest", ["file_path"], unique=True, schema=SCHEMA
    )

    op.create_table(
        "context_cache",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("cache_key", sa.String(100), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("cache_key", name="uq_context_cache_cache_key"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_context_cache_cache_key",
        "context_cache",
        ["cache_key"],
        unique=True,
        schema=SCHEMA,
    )
    op.create_index("ix_context_cache_expires_at", "context_cache", ["expires_at"], schema=SCHEMA)


def downgrade() -> None:
    op.drop_table("context_cache", schema=SCHEMA)
    op.drop_table("file_manifest", schema=SCHEMA)
    op.drop_table("extracted_memories", schema=SCHEMA)
    op.drop_constraint("fk_dreams_transcript_id", "dreams", schema=SCHEMA, type_="foreignkey")
    op.drop_table("transcripts", schema=SCHEMA)
    op.drop_table("dreams", schema=SCHEMA)
    op.execute(f"DROP SCHEMA IF EXISTS {SCHEMA}")
