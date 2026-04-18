"""add dreams.outcome enum column for end-state disambiguation

Adds a nullable VARCHAR(30) `outcome` column to `jarvis.dreams` to disambiguate
"completed" end-states (wrote_files | no_new_content | extraction_empty |
record_soft_fail). NULL means no meaningful outcome (typically a hard failure).

Revision ID: 0008
Revises: 0007
Create Date: 2026-04-18
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "jarvis"


def upgrade() -> None:
    op.add_column(
        "dreams",
        sa.Column("outcome", sa.String(30), nullable=True),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("dreams", "outcome", schema=SCHEMA)
