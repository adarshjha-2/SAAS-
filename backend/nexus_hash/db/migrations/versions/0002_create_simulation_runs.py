"""create simulation runs

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-05 12:44:21.949166
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "simulation_runs",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column(
            "kind",
            sa.Enum(
                "mine",
                "benchmark",
                name="simulation_kind",
                native_enum=False,
                create_constraint=True,
                length=16,
            ),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "queued",
                "running",
                "succeeded",
                "exhausted",
                "timed_out",
                "cancelled",
                "failed",
                name="simulation_status",
                native_enum=False,
                create_constraint=True,
                length=16,
            ),
            nullable=False,
        ),
        sa.Column("difficulty_bits", sa.Integer(), nullable=False),
        sa.Column("max_seconds", sa.Float(), nullable=False),
        sa.Column("consent", sa.Boolean(), nullable=False),
        sa.Column("header", sa.JSON(), nullable=False),
        sa.Column("start_nonce", sa.BigInteger(), nullable=False),
        sa.Column("attempts", sa.BigInteger(), nullable=False),
        sa.Column("elapsed_seconds", sa.Float(), nullable=False),
        sa.Column("hash_rate_hs", sa.Float(), nullable=True),
        sa.Column("best_hash", sa.String(length=64), nullable=True),
        sa.Column("best_zero_bits", sa.Integer(), nullable=True),
        sa.Column("found_nonce", sa.BigInteger(), nullable=True),
        sa.Column("found_hash", sa.String(length=64), nullable=True),
        sa.Column("error", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_simulation_runs")),
    )
    with op.batch_alter_table("simulation_runs") as batch_op:
        batch_op.create_index("ix_simulation_runs_created_at", ["created_at"], unique=False)
        batch_op.create_index("ix_simulation_runs_status", ["status"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("simulation_runs") as batch_op:
        batch_op.drop_index("ix_simulation_runs_status")
        batch_op.drop_index("ix_simulation_runs_created_at")

    op.drop_table("simulation_runs")
