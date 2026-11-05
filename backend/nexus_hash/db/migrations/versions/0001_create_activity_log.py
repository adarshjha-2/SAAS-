"""create activity log

Revision ID: 0001
Revises:
Create Date: 2026-11-05

Migrations are self-contained snapshots: they use plain SQLAlchemy types
(the `ts` column is stored as naive UTC DATETIME; the application's
UTCDateTime type adds the timezone on read) and never import app models.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _enum(name: str, *values: str) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False, create_constraint=True, length=16)


def upgrade() -> None:
    op.create_table(
        "activity_log",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("ts", sa.DateTime(), nullable=False),
        sa.Column(
            "level", _enum("activity_level", "info", "success", "warning", "error"), nullable=False
        ),
        sa.Column(
            "category",
            _enum(
                "activity_category",
                "system",
                "database",
                "hashlab",
                "hardware",
                "network",
                "profitability",
                "intelligence",
                "core",
            ),
            nullable=False,
        ),
        sa.Column("actor", _enum("activity_actor", "system", "user"), nullable=False),
        sa.Column("message", sa.String(length=500), nullable=False),
        sa.Column("detail", sa.String(length=2000), nullable=True),
        sa.Column("context", sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_activity_log")),
    )
    with op.batch_alter_table("activity_log") as batch_op:
        batch_op.create_index("ix_activity_log_ts", ["ts"], unique=False)
        batch_op.create_index("ix_activity_log_category_id", ["category", "id"], unique=False)
        batch_op.create_index("ix_activity_log_level_id", ["level", "id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("activity_log") as batch_op:
        batch_op.drop_index("ix_activity_log_level_id")
        batch_op.drop_index("ix_activity_log_category_id")
        batch_op.drop_index("ix_activity_log_ts")
    op.drop_table("activity_log")
