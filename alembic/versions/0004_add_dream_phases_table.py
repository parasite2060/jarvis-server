"""add dream_phases table

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-15
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "jarvis"


def upgrade() -> None:
    op.create_table(
        "dream_phases",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("dream_id", sa.Integer(), sa.ForeignKey(f"{SCHEMA}.dreams.id"), nullable=False),
        sa.Column("phase", sa.String(50), nullable=False),
        sa.Column("status", sa.String(50), nullable=False, server_default="processing"),
        sa.Column("run_prompt", sa.Text(), nullable=True),
        sa.Column("output_json", sa.dialects.postgresql.JSONB(), nullable=True),
        sa.Column("conversation_history", sa.dialects.postgresql.JSONB(), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("total_tokens", sa.Integer(), nullable=True),
        sa.Column("tool_calls", sa.Integer(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        schema=SCHEMA,
    )
    op.create_index("ix_dream_phases_dream_id", "dream_phases", ["dream_id"], schema=SCHEMA)
    op.create_index("ix_dream_phases_phase", "dream_phases", ["phase"], schema=SCHEMA)


def downgrade() -> None:
    op.drop_index("ix_dream_phases_phase", table_name="dream_phases", schema=SCHEMA)
    op.drop_index("ix_dream_phases_dream_id", table_name="dream_phases", schema=SCHEMA)
    op.drop_table("dream_phases", schema=SCHEMA)
