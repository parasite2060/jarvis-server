"""extraction_under_yield outcome marker (no-DDL)

Documents the addition of ``"extraction_under_yield"`` to ``DREAM_OUTCOMES``.
``Dream.outcome`` is ``String(30)`` with no enum or CHECK constraint
(see ``0008_add_dream_outcome``), so adding a new convention-level value needs
no DDL. This migration exists purely to anchor the change in
``alembic_version`` history and provide a concrete reversal point if a future
maintainer chooses to add a constraint.

Revision ID: 0009
Revises: 0008
Create Date: 2026-05-04
"""

from collections.abc import Sequence

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """No-op: ``DREAM_OUTCOMES`` is a Python tuple; the column is unconstrained."""
    pass


def downgrade() -> None:
    """No-op: nothing was added at the DB level to remove."""
    pass
