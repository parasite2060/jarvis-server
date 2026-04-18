"""consolidate session-log storage onto dreams.session_log JSONB

Drops the extracted_memories table (replaced by dreams.session_log->'memories' JSONB)
and the dreams.memories_extracted counter column (derivable from
jsonb_array_length(session_log->'memories')). Adds the session_log JSONB column
to dreams. This is the single source of truth for a light dream's session data.

Revision ID: 0007
Revises: 0006
Create Date: 2026-04-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "jarvis"


def upgrade() -> None:
    # 1) Add session_log JSONB column to dreams (nullable, no default).
    op.add_column(
        "dreams",
        sa.Column(
            "session_log",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        schema=SCHEMA,
    )

    # 2) Drop dreams.memories_extracted counter column.
    op.drop_column("dreams", "memories_extracted", schema=SCHEMA)

    # 3) Drop extracted_memories table (indexes + FK + table).
    op.drop_index(
        "ix_extracted_memories_source_date",
        table_name="extracted_memories",
        schema=SCHEMA,
    )
    op.drop_index(
        "ix_extracted_memories_vault_target",
        table_name="extracted_memories",
        schema=SCHEMA,
    )
    op.drop_index(
        "ix_extracted_memories_type",
        table_name="extracted_memories",
        schema=SCHEMA,
    )
    op.drop_table("extracted_memories", schema=SCHEMA)


def downgrade() -> None:
    # 1) Re-create extracted_memories table (empty).
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
    op.create_index(
        "ix_extracted_memories_type",
        "extracted_memories",
        ["type"],
        schema=SCHEMA,
    )
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

    # 2) Restore dreams.memories_extracted.
    op.add_column(
        "dreams",
        sa.Column(
            "memories_extracted",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        schema=SCHEMA,
    )

    # 3) Drop session_log.
    op.drop_column("dreams", "session_log", schema=SCHEMA)
