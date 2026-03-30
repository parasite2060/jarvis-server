"""add source column to transcripts

Revision ID: 0002
Revises: 0001
Create Date: 2026-03-30
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "jarvis"


def upgrade() -> None:
    op.add_column(
        "transcripts",
        sa.Column("source", sa.String(50), nullable=True),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_transcripts_session_source",
        "transcripts",
        ["session_id", "source"],
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_transcripts_session_source",
        table_name="transcripts",
        schema=SCHEMA,
    )
    op.drop_column("transcripts", "source", schema=SCHEMA)
