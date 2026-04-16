"""add is_continuation column to transcripts

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-15
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "jarvis"


def upgrade() -> None:
    op.add_column(
        "transcripts",
        sa.Column("is_continuation", sa.Boolean(), server_default="false", nullable=False),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("transcripts", "is_continuation", schema=SCHEMA)
