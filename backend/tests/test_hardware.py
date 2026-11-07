"""Hardware Intelligence: probes, aggregation, monitor lifecycle and API."""

from __future__ import annotations

import time
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from nexus_hash.main import create_app
from nexus_hash.modules.hardware import probe as probe_module
from nexus_hash.modules.hardware.models import HardwareSampleRow
from nexus_hash.modules.hardware.probe import SystemProbe, _cgroup_memory_limit, _Rapl
from nexus_hash.modules.hardware.schemas import (
    Capability,
    CapabilityKey,
    GpuReading,
    HardwareSample,
    HardwareSpecs,
    MemoryReading,
    ProcessReading,
    TemperatureReading,
)
from nexus_hash.modules.hardware.service import HardwareMonitor, aggregate, capability_summary
from tests.conftest import make_settings

API = "/api/v1/hardware"


def _sample(cpu: float = 20.0, **overrides: Any) -> HardwareSample:
    values: dict[str, Any] = {
        "ts": datetime.now(UTC),
        "cpu_percent": cpu,
        "cpu_per_core": [cpu, cpu],
        "cpu_frequency_mhz": 2_100.0,
        "load_average": (0.5, 0.4, 0.3),
        "memory": MemoryReading(
            total_bytes=8_000, used_bytes=2_000, available_bytes=6_000, percent=25.0
        ),
        "swap": None,
        "temperatures": None,
        "gpus": None,
        "power_w": None,
        "process": ProcessReading(cpu_percent=0.2, rss_bytes=40_000_000),
    }
    values.update(overrides)
    return HardwareSample(**values)


CAPABILITIES = [
    Capability(
        key=CapabilityKey.CPU, label="CPU utilisation", supported=True, source="psutil", reason=None
    ),
    Capability(
        key=CapabilityKey.MEMORY, label="Memory", supported=True, source="psutil", reason=None
    ),
    Capability(
        key=CapabilityKey.GPU,
        label="GPU",
        supported=False,
        source=None,
        reason="No NVIDIA driver (NVML library) found on this machine.",
    ),
    Capability(
        key=CapabilityKey.TEMPERATURE,
        label="Temperatures",
        supported=False,
        source=None,
        reason="No temperature sensors are exposed.",
    ),
]


class FakeProbe:
    """Deterministic probe: CPU climbs by 1% per sample; can fail on demand."""

    def __init__(self, fail_first: int = 0) -> None:
        self.calls = 0
        self.fail_first = fail_first

    def specs(self) -> HardwareSpecs:
        return HardwareSpecs(
            hostname="test-host",
            os="Linux 6.0",
            architecture="x86_64",
            cpu_model="Test CPU",
            cpu_logical_cores=2,
            cpu_physical_cores=2,
            cpu_max_frequency_mhz=None,
            memory_total_bytes=8_000,
            memory_limit_bytes=None,
            swap_total_bytes=0,
            virtualized=True,
            boot_time=datetime(2026, 11, 1, tzinfo=UTC),
            gpus=[],
            capabilities=CAPABILITIES,
        )

    def sample(self) -> HardwareSample:
        self.calls += 1
        if self.calls <= self.fail_first:
            raise OSError("sensor read failed")
        return _sample(cpu=float(self.calls))


@pytest.fixture
def fake_probe() -> FakeProbe:
    return FakeProbe()


@pytest.fixture
def hw(fake_probe: FakeProbe) -> Iterator[TestClient]:
    app = create_app(
        make_settings(hardware_sample_seconds=0.5), hardware_probe_factory=lambda: fake_probe
    )
    with TestClient(app) as client:
        yield client


def wait_for(predicate: Any, timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.05)
    raise AssertionError("condition not met in time")


# --- Real probe ---------------------------------------------------------------------------


def test_real_probe_reports_a_consistent_capability_matrix() -> None:
    probe = SystemProbe()
    specs = probe.specs()
    keys = {capability.key for capability in specs.capabilities}
    assert keys == set(CapabilityKey)
    for capability in specs.capabilities:
        # Every unavailable metric explains why; every available one names its source.
        assert (capability.source is not None) if capability.supported else bool(capability.reason)
    assert specs.memory_total_bytes > 0
    assert specs.cpu_logical_cores is not None
    assert specs.cpu_logical_cores >= 1

    time.sleep(0.1)
    sample = probe.sample()
    supported = {capability.key: capability.supported for capability in specs.capabilities}
    assert 0 <= sample.cpu_percent <= 100
    assert len(sample.cpu_per_core) == specs.cpu_logical_cores
    assert 0 < sample.memory.percent < 100
    assert sample.process.rss_bytes > 0
    # Unsupported metrics are null, never zero.
    assert (sample.temperatures is None) == (not supported[CapabilityKey.TEMPERATURE])
    assert (sample.gpus is None) == (not supported[CapabilityKey.GPU])
    assert (sample.swap is None) == (not supported[CapabilityKey.SWAP])


def test_real_probe_sampling_is_cheap() -> None:
    probe = SystemProbe()
    started = time.perf_counter()
    for _ in range(50):
        probe.sample()
    per_sample = (time.perf_counter() - started) / 50
    assert per_sample < 0.02  # well under 1% of a core at a 2 s interval


# --- RAPL power ------------------------------------------------------------------------------


def _rapl_tree(root: Path, energy: int, max_range: int = 1_000_000_000) -> Path:
    package = root / "intel-rapl:0"
    package.mkdir(parents=True)
    (package / "energy_uj").write_text(str(energy))
    (package / "max_energy_range_uj").write_text(str(max_range))
    core = root / "intel-rapl:0:0"  # sub-domain, already included in the package
    core.mkdir()
    (core / "energy_uj").write_text("5")
    (core / "max_energy_range_uj").write_text(str(max_range))
    return package / "energy_uj"


def test_rapl_computes_average_watts(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    counter = _rapl_tree(tmp_path, energy=1_000_000)
    clock = iter([100.0, 102.0])
    monkeypatch.setattr(probe_module.time, "monotonic", lambda: next(clock))
    rapl = _Rapl(tmp_path)
    assert rapl.supported
    assert rapl.watts() is None  # first call only primes the counter
    counter.write_text(str(1_000_000 + 30_000_000))  # 30 J over 2 s
    assert rapl.watts() == pytest.approx(15.0)


def test_rapl_handles_counter_wraparound(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    counter = _rapl_tree(tmp_path, energy=999_000_000, max_range=1_000_000_000)
    clock = iter([0.0, 1.0])
    monkeypatch.setattr(probe_module.time, "monotonic", lambda: next(clock))
    rapl = _Rapl(tmp_path)
    rapl.watts()
    counter.write_text("4000000")  # wrapped: 1 J before the wrap + 4 J after
    assert rapl.watts() == pytest.approx(5.0)


def test_rapl_explains_why_it_is_unavailable(tmp_path: Path) -> None:
    assert "No RAPL power interface" in (_Rapl(tmp_path / "missing").reason or "")
    empty = tmp_path / "powercap"
    empty.mkdir()
    assert "No readable CPU package" in (_Rapl(empty).reason or "")


def test_cgroup_memory_limit(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    limit_file = tmp_path / "memory.max"
    monkeypatch.setattr(probe_module, "CGROUP_MEMORY_FILES", (limit_file,))
    assert _cgroup_memory_limit(8_000) is None  # no cgroup file
    limit_file.write_text("max")
    assert _cgroup_memory_limit(8_000) is None  # unlimited
    limit_file.write_text("4000")
    assert _cgroup_memory_limit(8_000) == 4_000
    limit_file.write_text("9000")
    assert _cgroup_memory_limit(8_000) is None  # not a real restriction


# --- Aggregation -------------------------------------------------------------------------------


def test_aggregate_summarises_a_window() -> None:
    samples = [
        _sample(
            10.0, temperatures=[TemperatureReading(label="Package", celsius=50.0)], power_w=20.0
        ),
        _sample(
            30.0, temperatures=[TemperatureReading(label="Package", celsius=61.5)], power_w=40.0
        ),
        _sample(
            50.0,
            gpus=[
                GpuReading(
                    index=0,
                    utilization_percent=80.0,
                    memory_used_bytes=1,
                    memory_total_bytes=2,
                    temperature_c=None,
                    power_w=None,
                )
            ],
        ),
    ]
    row = aggregate(samples, 60.0)
    assert row.samples == 3
    assert row.cpu_avg == 30.0
    assert row.cpu_max == 50.0
    assert row.memory_percent_avg == 25.0
    assert row.load1_avg == 0.5
    assert row.temperature_max_c == 61.5
    assert row.power_avg_w == 30.0
    assert row.gpu_utilization_avg == 80.0
    assert row.ts == samples[-1].ts


def test_aggregate_keeps_unsupported_metrics_null() -> None:
    row = aggregate([_sample(5.0, load_average=None)], 60.0)
    assert row.load1_avg is None
    assert row.temperature_max_c is None
    assert row.power_avg_w is None
    assert row.gpu_utilization_avg is None
    with pytest.raises(ValueError, match="empty"):
        aggregate([], 60.0)


def test_capability_summary_names_what_is_missing_and_why() -> None:
    message, detail = capability_summary(FakeProbe().specs())
    assert message == "Hardware monitoring started"
    assert detail == (
        "Available: CPU utilisation, Memory. Not available here: "
        "GPU (No NVIDIA driver (NVML library) found on this machine); "
        "Temperatures (No temperature sensors are exposed)."
    )


# --- API and monitor ---------------------------------------------------------------


def test_specs_include_the_capability_matrix(hw: TestClient) -> None:
    body = hw.get(f"{API}/specs").json()
    assert body["cpu_model"] == "Test CPU"
    gpu = next(cap for cap in body["capabilities"] if cap["key"] == "gpu")
    assert gpu == {
        "key": "gpu",
        "label": "GPU",
        "supported": False,
        "source": None,
        "reason": "No NVIDIA driver (NVML library) found on this machine.",
    }


def test_startup_announces_capabilities_in_the_activity_log(hw: TestClient) -> None:
    entries = hw.get("/api/v1/activity", params={"category": "hardware"}).json()["items"]
    assert [entry["message"] for entry in entries] == ["Hardware monitoring started"]
    assert "GPU (No NVIDIA driver" in entries[0]["detail"]


def test_live_samples_accumulate(hw: TestClient) -> None:
    wait_for(lambda: len(hw.get(f"{API}/live").json()["samples"]) >= 2)
    live = hw.get(f"{API}/live").json()
    assert live["interval_seconds"] == 0.5
    cpus = [sample["cpu_percent"] for sample in live["samples"]]
    assert cpus == sorted(cpus)  # oldest first
    assert live["samples"][0]["temperatures"] is None


def test_samples_stream_on_the_hardware_topic(hw: TestClient) -> None:
    with hw.websocket_connect("/ws/v1") as ws:
        ws.receive_json()  # welcome
        ws.send_json({"action": "subscribe", "topics": ["hardware"]})
        assert ws.receive_json()["kind"] == "ack"
        events = [ws.receive_json() for _ in range(3)]
    assert all(event["topic"] == "hardware" and event["type"] == "sample" for event in events)
    cpus = [event["data"]["sample"]["cpu_percent"] for event in events if event["data"]["sample"]]
    assert cpus == sorted(cpus)


def test_history_is_aggregated_and_persisted(hw: TestClient) -> None:
    monitor: HardwareMonitor = hw.app.state.hardware  # type: ignore[attr-defined]
    assert hw.portal is not None
    wait_for(lambda: len(monitor.live().samples) >= 2)
    hw.portal.call(monitor.flush)
    points = hw.get(f"{API}/history", params={"hours": 1}).json()["points"]
    assert len(points) == 1
    assert points[0]["samples"] >= 2
    assert points[0]["cpu_max"] >= points[0]["cpu_avg"] > 0
    assert points[0]["temperature_max_c"] is None


def test_flush_applies_retention(hw: TestClient) -> None:
    monitor: HardwareMonitor = hw.app.state.hardware  # type: ignore[attr-defined]
    assert hw.portal is not None

    async def insert_old_row() -> None:
        async with monitor._sessions() as session, session.begin():
            session.add(
                HardwareSampleRow(
                    ts=datetime.now(UTC) - timedelta(days=30),
                    window_seconds=60,
                    samples=30,
                    cpu_avg=1,
                    cpu_max=2,
                    memory_percent_avg=3,
                )
            )

    hw.portal.call(insert_old_row)
    assert len(hw.get(f"{API}/history", params={"hours": 24 * 60}).json()["points"]) == 1
    wait_for(lambda: len(monitor.live().samples) >= 1)
    hw.portal.call(monitor.flush)
    points = hw.get(f"{API}/history", params={"hours": 24 * 60}).json()["points"]
    assert len(points) == 1  # the 30-day-old row is gone (7-day retention); today's row remains
    assert datetime.fromisoformat(points[0]["ts"]) > datetime.now(UTC) - timedelta(hours=1)


def test_shutdown_persists_the_partial_window(tmp_path: Path) -> None:
    settings = make_settings(database_path=tmp_path / "hw.db", hardware_sample_seconds=0.5)
    with TestClient(create_app(settings, hardware_probe_factory=FakeProbe)) as client:
        monitor: HardwareMonitor = client.app.state.hardware  # type: ignore[attr-defined]
        wait_for(lambda: len(monitor.live().samples) >= 2)
    with TestClient(create_app(settings, hardware_probe_factory=FakeProbe)) as client:
        points = client.get(f"{API}/history", params={"hours": 1}).json()["points"]
    assert points
    assert points[0]["samples"] >= 2


def test_monitor_survives_probe_failures() -> None:
    probe = FakeProbe(fail_first=2)
    app = create_app(
        make_settings(hardware_sample_seconds=0.5), hardware_probe_factory=lambda: probe
    )
    with TestClient(app) as client:
        wait_for(lambda: len(client.get(f"{API}/live").json()["samples"]) >= 1)
        assert probe.calls >= 3
        assert client.get("/api/v1/system/health").json()["status"] == "ok"


@pytest.mark.parametrize("hours", [0, -1, 24 * 366])
def test_history_validation(hw: TestClient, hours: float) -> None:
    assert hw.get(f"{API}/history", params={"hours": hours}).status_code == 422


def test_disabled_monitoring_is_explained(tmp_path: Path) -> None:
    app = create_app(make_settings(hardware_monitoring_enabled=False))
    with TestClient(app) as client:
        response = client.get(f"{API}/specs")
        entries = client.get("/api/v1/activity", params={"category": "hardware"}).json()["items"]
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "service_unavailable"
    assert "NEXUS_HARDWARE_MONITORING_ENABLED" in response.json()["error"]["message"]
    assert entries == []


# --- Hardware this VM lacks: exercised with fakes so the code paths are proven -------


class _Memory:
    total = 8_000_000_000
    used = 2_000_000_000


class _Utilization:
    gpu = 75


class FakeNvml:
    """Stand-in for NVIDIA's `pynvml` binding with one GPU."""

    NVML_TEMPERATURE_GPU = 0

    def __init__(self, count: int = 1, init_error: Exception | None = None) -> None:
        self._count = count
        self._init_error = init_error

    def nvmlInit(self) -> None:  # noqa: N802 - mirrors the real API
        if self._init_error:
            raise self._init_error

    def nvmlDeviceGetCount(self) -> int:  # noqa: N802
        return self._count

    def nvmlDeviceGetHandleByIndex(self, index: int) -> str:  # noqa: N802
        return f"gpu-{index}"

    def nvmlDeviceGetName(self, _handle: str) -> bytes:  # noqa: N802
        return b"NVIDIA Test GPU"

    def nvmlDeviceGetMemoryInfo(self, _handle: str) -> _Memory:  # noqa: N802
        return _Memory()

    def nvmlDeviceGetUtilizationRates(self, _handle: str) -> _Utilization:  # noqa: N802
        return _Utilization()

    def nvmlDeviceGetTemperature(self, _handle: str, _sensor: int) -> int:  # noqa: N802
        return 66

    def nvmlDeviceGetPowerUsage(self, _handle: str) -> int:  # noqa: N802
        raise RuntimeError("NVML_ERROR_NOT_SUPPORTED")  # some cards don't report power


def test_nvidia_gpu_is_read_when_present(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(__import__("sys").modules, "pynvml", FakeNvml())
    probe = SystemProbe()
    specs = probe.specs()
    gpu = next(cap for cap in specs.capabilities if cap.key is CapabilityKey.GPU)
    assert gpu.supported
    assert gpu.source == "NVIDIA NVML"
    assert [spec.name for spec in specs.gpus] == ["NVIDIA Test GPU"]
    assert specs.gpus[0].memory_total_bytes == 8_000_000_000

    reading = probe.sample().gpus
    assert reading is not None
    assert reading[0].utilization_percent == 75.0
    assert reading[0].temperature_c == 66.0
    assert reading[0].memory_used_bytes == 2_000_000_000
    assert reading[0].power_w is None  # unsupported by this card: null, not zero


@pytest.mark.parametrize(
    ("fake", "reason"),
    [
        (FakeNvml(count=0), "The NVIDIA driver reports no GPUs."),
        (FakeNvml(init_error=RuntimeError("driver not loaded")), "unavailable (RuntimeError)"),
    ],
)
def test_nvidia_failures_explain_themselves(
    monkeypatch: pytest.MonkeyPatch, fake: FakeNvml, reason: str
) -> None:
    monkeypatch.setitem(__import__("sys").modules, "pynvml", fake)
    gpu = next(cap for cap in SystemProbe().capabilities() if cap.key is CapabilityKey.GPU)
    assert not gpu.supported
    assert reason in (gpu.reason or "")


class _Temp:
    def __init__(self, label: str, current: float | None) -> None:
        self.label = label
        self.current = current


def test_cpu_temperatures_are_read_and_bogus_values_dropped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sensors = {
        "nvme": [_Temp("Composite", 40.0)],
        "coretemp": [_Temp("Package id 0", 55.0), _Temp("Core 0", 200.0), _Temp("", 52.5)],
    }
    monkeypatch.setattr(probe_module.psutil, "sensors_temperatures", lambda: sensors, raising=False)
    probe = SystemProbe()
    temperature = next(cap for cap in probe.capabilities() if cap.key is CapabilityKey.TEMPERATURE)
    assert temperature.supported
    readings = probe.sample().temperatures
    # CPU sensors are preferred over others; the impossible 200 °C glitch is discarded.
    assert readings == [
        TemperatureReading(label="Package id 0", celsius=55.0),
        TemperatureReading(label="coretemp", celsius=52.5),
    ]


@pytest.mark.parametrize(
    ("virtualized", "expected"),
    [
        (True, "virtual machines usually hide them"),
        (False, "No temperature sensors are exposed by this machine"),
    ],
)
def test_missing_temperature_reason(
    monkeypatch: pytest.MonkeyPatch, virtualized: bool, expected: str
) -> None:
    monkeypatch.setattr(probe_module.psutil, "sensors_temperatures", lambda: {}, raising=False)
    monkeypatch.setattr(probe_module, "_virtualized", lambda: virtualized)
    temperature = next(
        cap for cap in SystemProbe().capabilities() if cap.key is CapabilityKey.TEMPERATURE
    )
    assert not temperature.supported
    assert expected in (temperature.reason or "")


def test_rapl_permission_denied_is_explained(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _rapl_tree(tmp_path, energy=1)
    real_read_text = Path.read_text

    def deny(self: Path, *args: Any, **kwargs: Any) -> str:
        if self.name == "energy_uj":
            raise PermissionError(13, "Permission denied")
        return real_read_text(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", deny)
    assert "not readable without root" in (_Rapl(tmp_path).reason or "")
