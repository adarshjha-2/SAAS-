"""Read-only probes for hardware metrics.

Each optional source (temperature sensors, NVIDIA GPUs via NVML, Intel RAPL
power) is detected once. When a source is missing, the probe records *why*,
so the UI can say "not available on this machine" instead of showing zero.
Nothing here generates load: every call is a counter or sensor read.
"""

from __future__ import annotations

import logging
import os
import platform
import socket
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

import psutil

from .schemas import (
    Capability,
    CapabilityKey,
    GpuReading,
    GpuSpec,
    HardwareSample,
    HardwareSpecs,
    MemoryReading,
    ProcessReading,
    SwapReading,
    TemperatureReading,
)

logger = logging.getLogger("nexus_hash.hardware")

RAPL_ROOT = Path("/sys/class/powercap")
CGROUP_MEMORY_FILES = (
    Path("/sys/fs/cgroup/memory.max"),  # cgroup v2
    Path("/sys/fs/cgroup/memory/memory.limit_in_bytes"),  # cgroup v1
)
# Readings outside this range are sensor glitches, not temperatures.
PLAUSIBLE_CELSIUS = (-40.0, 150.0)
CPU_SENSOR_NAMES = (
    "coretemp",
    "k10temp",
    "zenpower",
    "cpu_thermal",
    "cpu-thermal",
    "acpitz",
    "soc_thermal",
)


class Probe(Protocol):
    def specs(self) -> HardwareSpecs: ...
    def sample(self) -> HardwareSample: ...


def _cpu_model() -> str | None:
    if platform.system() == "Linux":
        try:
            for line in Path("/proc/cpuinfo").read_text().splitlines():
                if line.startswith("model name"):
                    return line.split(":", 1)[1].strip()
        except OSError:
            return None
    return platform.processor() or None


def _virtualized() -> bool | None:
    """True when the CPU reports running under a hypervisor (Linux only)."""
    try:
        for line in Path("/proc/cpuinfo").read_text().splitlines():
            if line.startswith("flags"):
                return "hypervisor" in line.split()
    except OSError:
        return None
    return None


def _cgroup_memory_limit(physical: int) -> int | None:
    for path in CGROUP_MEMORY_FILES:
        try:
            raw = path.read_text().strip()
        except OSError:
            continue
        if raw.isdigit() and 0 < int(raw) < physical:
            return int(raw)
    return None


class _Nvml:
    """Optional NVIDIA GPU access. Never raises; records why it is unavailable."""

    def __init__(self) -> None:
        self.handles: list[Any] = []
        self.reason: str | None = None
        try:
            import pynvml  # noqa: PLC0415 - optional dependency, loaded lazily

            pynvml.nvmlInit()
            self._nvml = pynvml
            self.handles = [
                pynvml.nvmlDeviceGetHandleByIndex(i) for i in range(pynvml.nvmlDeviceGetCount())
            ]
            if not self.handles:
                self.reason = "The NVIDIA driver reports no GPUs."
        except Exception as exc:  # NVMLError_LibraryNotFound, DriverNotLoaded, ...
            self.reason = (
                "No NVIDIA driver (NVML library) found on this machine."
                if "LibraryNotFound" in type(exc).__name__
                else f"NVIDIA GPU monitoring is unavailable ({type(exc).__name__})."
            )

    @property
    def supported(self) -> bool:
        return bool(self.handles)

    def _try(self, fn: Any, *args: Any) -> Any:
        try:
            return fn(*args)
        except Exception:
            return None

    def specs(self) -> list[GpuSpec]:
        out = []
        for index, handle in enumerate(self.handles):
            name = self._try(self._nvml.nvmlDeviceGetName, handle)
            memory = self._try(self._nvml.nvmlDeviceGetMemoryInfo, handle)
            out.append(
                GpuSpec(
                    index=index,
                    name=name.decode() if isinstance(name, bytes) else str(name or f"GPU {index}"),
                    memory_total_bytes=int(memory.total) if memory else None,
                )
            )
        return out

    def readings(self) -> list[GpuReading]:
        nvml = self._nvml
        out = []
        for index, handle in enumerate(self.handles):
            utilization = self._try(nvml.nvmlDeviceGetUtilizationRates, handle)
            memory = self._try(nvml.nvmlDeviceGetMemoryInfo, handle)
            temperature = self._try(
                nvml.nvmlDeviceGetTemperature, handle, nvml.NVML_TEMPERATURE_GPU
            )
            power_mw = self._try(nvml.nvmlDeviceGetPowerUsage, handle)
            out.append(
                GpuReading(
                    index=index,
                    utilization_percent=float(utilization.gpu) if utilization else None,
                    memory_used_bytes=int(memory.used) if memory else None,
                    memory_total_bytes=int(memory.total) if memory else None,
                    temperature_c=float(temperature) if temperature is not None else None,
                    power_w=power_mw / 1000 if power_mw is not None else None,
                )
            )
        return out


class _Rapl:
    """CPU package power from Intel RAPL energy counters (Linux powercap)."""

    def __init__(self, root: Path = RAPL_ROOT) -> None:
        self.domains: list[tuple[Path, int]] = []
        self.reason: str | None = None
        self._last: tuple[float, list[int]] | None = None
        if not root.is_dir():
            self.reason = "No RAPL power interface (/sys/class/powercap) on this machine."
            return
        for domain in sorted(root.glob("intel-rapl:[0-9]*")):
            if ":" in domain.name.split("intel-rapl:", 1)[1]:
                continue  # sub-domains (core, uncore) are already inside the package total
            energy = domain / "energy_uj"
            try:
                int(energy.read_text())
                max_range = int((domain / "max_energy_range_uj").read_text())
            except PermissionError:
                self.reason = "RAPL energy counters exist but are not readable without root."
                return
            except (OSError, ValueError):
                continue
            self.domains.append((energy, max_range))
        if not self.domains and self.reason is None:
            self.reason = "No readable CPU package power domains in /sys/class/powercap."

    @property
    def supported(self) -> bool:
        return bool(self.domains)

    def watts(self) -> float | None:
        """Average power since the previous call; None on the first call."""
        if not self.domains:
            return None
        now = time.monotonic()
        try:
            readings = [int(path.read_text()) for path, _ in self.domains]
        except (OSError, ValueError):
            return None
        previous, self._last = self._last, (now, readings)
        if previous is None or now <= previous[0]:
            return None
        joules = 0.0
        for (before, after), (_, max_range) in zip(
            zip(previous[1], readings, strict=True), self.domains, strict=True
        ):
            delta = (
                after - before if after >= before else after + max_range - before
            )  # counter wrap
            joules += delta / 1e6
        return joules / (now - previous[0])


def _temperature_reason() -> str:
    if not hasattr(psutil, "sensors_temperatures"):
        return "This operating system does not expose temperature sensors to applications."
    if _virtualized():
        return "No temperature sensors are exposed; virtual machines usually hide them."
    return "No temperature sensors are exposed by this machine."


class SystemProbe:
    """The real probe, backed by psutil, NVML and RAPL."""

    def __init__(self) -> None:
        self._process = psutil.Process(os.getpid())
        # Prime the CPU counters: psutil reports usage since the previous call.
        psutil.cpu_percent(percpu=True)
        self._process.cpu_percent()
        self._nvml = _Nvml()
        self._rapl = _Rapl()
        self._rapl.watts()
        self._temperatures_supported = bool(self._read_temperatures())

    # --- Static information ------------------------------------------------------------

    def capabilities(self) -> list[Capability]:
        frequency = self._frequency()
        swap_total = psutil.swap_memory().total
        has_loadavg = hasattr(os, "getloadavg")
        return [
            Capability(
                key=CapabilityKey.CPU,
                label="CPU utilisation",
                supported=True,
                source="psutil",
                reason=None,
            ),
            Capability(
                key=CapabilityKey.CPU_FREQUENCY,
                label="CPU frequency",
                supported=frequency is not None,
                source="psutil" if frequency is not None else None,
                reason=None
                if frequency is not None
                else "The CPU frequency is not exposed on this machine.",
            ),
            Capability(
                key=CapabilityKey.LOAD_AVERAGE,
                label="Load average",
                supported=has_loadavg,
                source="os.getloadavg" if has_loadavg else None,
                reason=None
                if has_loadavg
                else "Load average is not available on this operating system.",
            ),
            Capability(
                key=CapabilityKey.MEMORY,
                label="Memory",
                supported=True,
                source="psutil",
                reason=None,
            ),
            Capability(
                key=CapabilityKey.SWAP,
                label="Swap",
                supported=swap_total > 0,
                source="psutil" if swap_total > 0 else None,
                reason=None if swap_total > 0 else "No swap space is configured.",
            ),
            Capability(
                key=CapabilityKey.TEMPERATURE,
                label="Temperatures",
                supported=self._temperatures_supported,
                source="psutil" if self._temperatures_supported else None,
                reason=None if self._temperatures_supported else _temperature_reason(),
            ),
            Capability(
                key=CapabilityKey.GPU,
                label="GPU",
                supported=self._nvml.supported,
                source="NVIDIA NVML" if self._nvml.supported else None,
                reason=self._nvml.reason,
            ),
            Capability(
                key=CapabilityKey.POWER,
                label="Power draw",
                supported=self._rapl.supported or self._nvml.supported,
                source=("Intel RAPL" if self._rapl.supported else "NVIDIA NVML (GPU only)")
                if (self._rapl.supported or self._nvml.supported)
                else None,
                reason=None if self._rapl.supported else self._rapl.reason,
            ),
        ]

    def specs(self) -> HardwareSpecs:
        memory = psutil.virtual_memory()
        frequency = psutil.cpu_freq() if hasattr(psutil, "cpu_freq") else None
        max_mhz = frequency.max if frequency and frequency.max else None
        return HardwareSpecs(
            hostname=socket.gethostname(),
            os=f"{platform.system()} {platform.release()}",
            architecture=platform.machine(),
            cpu_model=_cpu_model(),
            cpu_logical_cores=psutil.cpu_count(),
            cpu_physical_cores=psutil.cpu_count(logical=False),
            cpu_max_frequency_mhz=max_mhz,
            memory_total_bytes=memory.total,
            memory_limit_bytes=_cgroup_memory_limit(memory.total),
            swap_total_bytes=psutil.swap_memory().total,
            virtualized=_virtualized(),
            boot_time=datetime.fromtimestamp(psutil.boot_time(), UTC),
            gpus=self._nvml.specs() if self._nvml.supported else [],
            capabilities=self.capabilities(),
        )

    # --- Live readings -------------------------------------------------------------------

    @staticmethod
    def _frequency() -> float | None:
        try:
            frequency = psutil.cpu_freq()
        except (OSError, NotImplementedError):
            return None
        return float(frequency.current) if frequency and frequency.current else None

    @staticmethod
    def _read_temperatures() -> list[TemperatureReading]:
        reader = getattr(psutil, "sensors_temperatures", None)
        if reader is None:
            return []
        try:
            sensors: dict[str, list[Any]] = reader()
        except (OSError, RuntimeError):
            return []
        preferred = [name for name in CPU_SENSOR_NAMES if name in sensors] or list(sensors)
        readings = []
        for name in preferred:
            for entry in sensors[name]:
                if (
                    entry.current is not None
                    and PLAUSIBLE_CELSIUS[0] < entry.current < PLAUSIBLE_CELSIUS[1]
                ):  # discard bogus values
                    readings.append(
                        TemperatureReading(label=entry.label or name, celsius=float(entry.current))
                    )
        return readings

    def sample(self) -> HardwareSample:
        per_core = psutil.cpu_percent(percpu=True)
        memory = psutil.virtual_memory()
        swap = psutil.swap_memory()
        rss = self._process.memory_info().rss
        return HardwareSample(
            ts=datetime.now(UTC),
            cpu_percent=round(sum(per_core) / len(per_core), 1) if per_core else 0.0,
            cpu_per_core=[round(value, 1) for value in per_core],
            cpu_frequency_mhz=self._frequency(),
            load_average=tuple(round(v, 2) for v in os.getloadavg())
            if hasattr(os, "getloadavg")
            else None,  # type: ignore[arg-type]
            memory=MemoryReading(
                total_bytes=memory.total,
                used_bytes=memory.total - memory.available,
                available_bytes=memory.available,
                percent=round(memory.percent, 1),
            ),
            swap=SwapReading(
                total_bytes=swap.total, used_bytes=swap.used, percent=round(swap.percent, 1)
            )
            if swap.total > 0
            else None,
            temperatures=self._read_temperatures() if self._temperatures_supported else None,
            gpus=self._nvml.readings() if self._nvml.supported else None,
            power_w=round(watts, 2) if (watts := self._rapl.watts()) is not None else None,
            process=ProcessReading(
                cpu_percent=round(self._process.cpu_percent(), 1), rss_bytes=rss
            ),
        )
