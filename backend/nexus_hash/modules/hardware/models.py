"""Persisted, aggregated hardware history (one row per aggregation window)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Float, Index, Integer
from sqlalchemy.orm import Mapped, mapped_column

from nexus_hash.db.base import Base, UTCDateTime


class HardwareSampleRow(Base):
    __tablename__ = "hardware_samples"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)  # end of the window
    window_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    samples: Mapped[int] = mapped_column(Integer, nullable=False)
    cpu_avg: Mapped[float] = mapped_column(Float, nullable=False)
    cpu_max: Mapped[float] = mapped_column(Float, nullable=False)
    memory_percent_avg: Mapped[float] = mapped_column(Float, nullable=False)
    load1_avg: Mapped[float | None] = mapped_column(Float, nullable=True)
    temperature_max_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    power_avg_w: Mapped[float | None] = mapped_column(Float, nullable=True)
    gpu_utilization_avg: Mapped[float | None] = mapped_column(Float, nullable=True)

    __table_args__ = (Index("ix_hardware_samples_ts", "ts"),)
