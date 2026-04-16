"""add segment tracking columns to transcripts

Revision ID: 0006
Revises: 0005
Create Date: 2026-04-15
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "jarvis"


def upgrade() -> None:
    op.add_column(
        "transcripts",
        sa.Column("segment_start_line", sa.Integer(), server_default="0", nullable=False),
        schema=SCHEMA,
    )
    op.add_column(
        "transcripts",
        sa.Column("segment_end_line", sa.Integer(), server_default="0", nullable=False),
        schema=SCHEMA,
    )
    op.add_column(
        "transcripts",
        sa.Column("last_processed_line", sa.Integer(), server_default="0", nullable=False),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("transcripts", "last_processed_line", schema=SCHEMA)
    op.drop_column("transcripts", "segment_end_line", schema=SCHEMA)
    op.drop_column("transcripts", "segment_start_line", schema=SCHEMA)
