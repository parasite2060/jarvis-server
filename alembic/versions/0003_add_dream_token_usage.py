"""add token usage columns to dreams

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-05
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "jarvis"


def upgrade() -> None:
    op.add_column(
        "dreams",
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "dreams",
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "dreams",
        sa.Column("total_tokens", sa.Integer(), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "dreams",
        sa.Column("tool_calls", sa.Integer(), nullable=True),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("dreams", "tool_calls", schema=SCHEMA)
    op.drop_column("dreams", "total_tokens", schema=SCHEMA)
    op.drop_column("dreams", "output_tokens", schema=SCHEMA)
    op.drop_column("dreams", "input_tokens", schema=SCHEMA)
