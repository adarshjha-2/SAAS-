"""Hardware Intelligence API contract."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel


class CapabilityKey(StrEnum):
    CPU = "cpu"
    CPU_FREQUENCY = "cpu_frequency"
    LOAD_AVERAGE = "load_average"
    MEMORY = "memory"
    SWAP = "swap"
    TEMPERATURE = "temperature"
    GPU = "gpu"
    POWER = "power"


class Capability(BaseModel):
    key: CapabilityKey
    label: str
    supported: bool
    source: str | None
    reason: str | None  # why it is unavailable (or a caveat when supported)


class GpuSpec(BaseModel):
    index: int
    name: str
    memory_total_bytes: int | None


class HardwareSpecs(BaseModel):
    hostname: str
    os: str
    architecture: str
    cpu_model: str | None
    cpu_logical_cores: int | None
    cpu_physical_cores: int | None
    cpu_max_frequency_mhz: float | None
    memory_total_bytes: int
    memory_limit_bytes: int | None  # container (cgroup) limit when lower than physical memory
    swap_total_bytes: int
    virtualized: bool | None
    boot_time: datetime
    gpus: list[GpuSpec]
    capabilities: list[Capability]


class MemoryReading(BaseModel):
    total_bytes: int
    used_bytes: int
    available_bytes: int
    percent: float


class SwapReading(BaseModel):
    total_bytes: int
    used_bytes: int
    percent: float


class TemperatureReading(BaseModel):
    label: str
    celsius: float


class GpuReading(BaseModel):
    index: int
    utilization_percent: float | None
    memory_used_bytes: int | None
    memory_total_bytes: int | None
    temperature_c: float | None
    power_w: float | None


class ProcessReading(BaseModel):
    """The NEXUS HASH AI server process itself: monitoring overhead made visible."""

    cpu_percent: float
    rss_bytes: int


class HardwareSample(BaseModel):
    ts: datetime
    cpu_percent: float
    cpu_per_core: list[float]
    cpu_frequency_mhz: float | None
    load_average: tuple[float, float, float] | None
    memory: MemoryReading
    swap: SwapReading | None  # None when the machine has no swap configured
    temperatures: list[TemperatureReading] | None  # None when unsupported
    gpus: list[GpuReading] | None  # None when unsupported
    power_w: float | None  # None when unsupported or not yet measurable
    process: ProcessReading


class LiveSamples(BaseModel):
    interval_seconds: float
    samples: list[HardwareSample]


class HistoryPoint(BaseModel):
    ts: datetime
    window_seconds: float
    samples: int
    cpu_avg: float
    cpu_max: float
    memory_percent_avg: float
    load1_avg: float | None
    temperature_max_c: float | None
    power_avg_w: float | None
    gpu_utilization_avg: float | None


class HardwareHistory(BaseModel):
    hours: float
    points: list[HistoryPoint]
