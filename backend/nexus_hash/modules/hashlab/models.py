"""ORM model for HashLab simulation runs (every run is a simulation)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, BigInteger, Boolean, Enum, Float, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from nexus_hash.db.base import Base, UTCDateTime

from .schemas import JobKind, JobStatus


def _enum(enum_type: type[JobKind | JobStatus], name: str) -> Enum:
    return Enum(
        enum_type,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=16,
        values_callable=lambda members: [member.value for member in members],
        validate_strings=True,
    )


class SimulationRun(Base):
    __tablename__ = "simulation_runs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    kind: Mapped[JobKind] = mapped_column(_enum(JobKind, "simulation_kind"), nullable=False)
    status: Mapped[JobStatus] = mapped_column(_enum(JobStatus, "simulation_status"), nullable=False)
    difficulty_bits: Mapped[int] = mapped_column(Integer, nullable=False)
    max_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    consent: Mapped[bool] = mapped_column(Boolean, nullable=False)
    header: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    start_nonce: Mapped[int] = mapped_column(BigInteger, nullable=False)
    attempts: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    elapsed_seconds: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    hash_rate_hs: Mapped[float | None] = mapped_column(Float, nullable=True)
    best_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    best_zero_bits: Mapped[int | None] = mapped_column(Integer, nullable=True)
    found_nonce: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    found_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)

    __table_args__ = (
        Index("ix_simulation_runs_created_at", "created_at"),
        Index("ix_simulation_runs_status", "status"),
    )
