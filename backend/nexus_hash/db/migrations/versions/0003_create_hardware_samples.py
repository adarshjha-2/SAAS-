"""create hardware samples

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-07 09:22:00.235407
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "hardware_samples",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("ts", sa.DateTime(), nullable=False),
        sa.Column("window_seconds", sa.Float(), nullable=False),
        sa.Column("samples", sa.Integer(), nullable=False),
        sa.Column("cpu_avg", sa.Float(), nullable=False),
        sa.Column("cpu_max", sa.Float(), nullable=False),
        sa.Column("memory_percent_avg", sa.Float(), nullable=False),
        sa.Column("load1_avg", sa.Float(), nullable=True),
        sa.Column("temperature_max_c", sa.Float(), nullable=True),
        sa.Column("power_avg_w", sa.Float(), nullable=True),
        sa.Column("gpu_utilization_avg", sa.Float(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_hardware_samples")),
    )
    with op.batch_alter_table("hardware_samples") as batch_op:
        batch_op.create_index("ix_hardware_samples_ts", ["ts"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("hardware_samples") as batch_op:
        batch_op.drop_index("ix_hardware_samples_ts")

    op.drop_table("hardware_samples")
