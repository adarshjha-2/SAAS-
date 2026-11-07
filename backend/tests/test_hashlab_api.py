"""HashLab HTTP API: instant demos, consent and limits, job lifecycle, audit."""

from __future__ import annotations

import hashlib
import time
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from nexus_hash.main import create_app
from nexus_hash.modules.hashlab.jobs import INTERRUPTED_ERROR, HashLabJobs, format_rate
from nexus_hash.modules.hashlab.models import SimulationRun
from nexus_hash.modules.hashlab.pow import GENESIS_BLOCK, GENESIS_HASH
from nexus_hash.modules.hashlab.schemas import HeaderInput, JobKind, JobStatus
from tests.conftest import make_settings

API = "/api/v1/hashlab"
GENESIS = HeaderInput.from_header(GENESIS_BLOCK).model_dump()


def thread_executor() -> ThreadPoolExecutor:
    return ThreadPoolExecutor(max_workers=1)


@pytest.fixture
def lab(tmp_path: Any) -> Iterator[TestClient]:
    """App wired with a thread executor: same code path, no process spawn cost."""
    app = create_app(make_settings(), hashlab_executor_factory=thread_executor)
    with TestClient(app) as client:
        yield client


def wait_finished(client: TestClient, job_id: str, timeout: float = 15.0) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job: dict[str, Any] = client.get(f"{API}/jobs/{job_id}").json()
        if job["status"] not in {"queued", "running"}:
            return job
        time.sleep(0.05)
    raise AssertionError(f"job {job_id} did not finish within {timeout}s")


def double_sha_value(header: dict[str, Any], nonce: int) -> int:
    """Independent check of a reported result, using plain hashlib."""
    serialized = HeaderInput(**{**header, "nonce": nonce}).to_header().serialize()
    return int.from_bytes(hashlib.sha256(hashlib.sha256(serialized).digest()).digest(), "little")


def activity_messages(client: TestClient, category: str = "hashlab") -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = client.get(
        "/api/v1/activity", params={"category": category}
    ).json()["items"]
    return items


# --- Instant demos ----------------------------------------------------------------------


def test_sha256_matches_the_nist_vector(lab: TestClient) -> None:
    body = lab.post(f"{API}/sha256", json={"text": "abc"}).json()
    assert body["sha256"] == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    assert body["double_sha256"] == hashlib.sha256(bytes.fromhex(body["sha256"])).hexdigest()
    assert body["input_bytes"] == 3
    assert body["simulated"] is True


def test_sha256_avalanche_effect(lab: TestClient) -> None:
    avalanche = lab.post(f"{API}/sha256", json={"text": "NEXUS"}).json()["avalanche"]
    flipped = hashlib.sha256(b"NEXUR").hexdigest()  # 'S' (0x53) ^ 1 == 'R' (0x52)
    assert avalanche["sha256"] == flipped
    original = int(hashlib.sha256(b"NEXUS").hexdigest(), 16)
    assert avalanche["changed_bits"] == (original ^ int(flipped, 16)).bit_count()
    assert avalanche["changed_percent"] == pytest.approx(avalanche["changed_bits"] / 2.56, abs=0.01)
    assert avalanche["flipped_bit"] == 39


def test_sha256_hex_input_and_empty_input(lab: TestClient) -> None:
    assert lab.post(f"{API}/sha256", json={"hex": "00ff"}).json()["sha256"] == (
        hashlib.sha256(b"\x00\xff").hexdigest()
    )
    empty = lab.post(f"{API}/sha256", json={"text": ""}).json()
    assert empty["avalanche"] is None
    assert empty["sha256"] == hashlib.sha256(b"").hexdigest()


@pytest.mark.parametrize(
    "payload",
    [{}, {"text": "a", "hex": "00"}, {"hex": "abc"}, {"hex": "zz"}, {"text": "x" * 1_001}],
)
def test_sha256_rejects_bad_input(lab: TestClient, payload: dict[str, Any]) -> None:
    assert lab.post(f"{API}/sha256", json=payload).status_code == 422


def test_header_analysis_of_the_genesis_block(lab: TestClient) -> None:
    body = lab.post(f"{API}/header", json=GENESIS).json()
    assert body["hash"] == GENESIS_HASH
    assert body["meets_target"] is True
    assert body["leading_zero_bits"] == 43
    assert body["difficulty"] == 1.0
    assert len(body["serialized_hex"]) == 160
    assert [field["name"] for field in body["fields"]] == [
        "version",
        "prev_block_hash",
        "merkle_root",
        "timestamp",
        "bits",
        "nonce",
    ]
    nonce = next(field for field in body["fields"] if field["name"] == "nonce")
    assert nonce["bytes_hex"] == GENESIS_BLOCK.nonce.to_bytes(4, "little").hex()


def test_changing_the_nonce_breaks_the_proof_of_work(lab: TestClient) -> None:
    body = lab.post(f"{API}/header", json={**GENESIS, "nonce": 0}).json()
    assert body["meets_target"] is False
    assert body["hash"] != GENESIS_HASH


@pytest.mark.parametrize(
    "override",
    [
        {"prev_block_hash": "ab"},
        {"merkle_root": "g" * 64},
        {"timestamp": -1},
        {"nonce": 2**32},
        {"bits": 0x01003456},  # zero target
        {"bits": 0x1D80FFFF},  # negative target
        {"version": 2**31},
    ],
)
def test_header_validation(lab: TestClient, override: dict[str, Any]) -> None:
    assert lab.post(f"{API}/header", json={**GENESIS, **override}).status_code == 422


def test_nonce_explorer(lab: TestClient) -> None:
    body = lab.post(
        f"{API}/nonces",
        json={
            "header": GENESIS,
            "start_nonce": GENESIS_BLOCK.nonce - 3,
            "count": 8,
            "difficulty_bits": 32,
        },
    ).json()
    assert [attempt["nonce"] for attempt in body["tries"]] == list(
        range(GENESIS_BLOCK.nonce - 3, GENESIS_BLOCK.nonce + 5)
    )
    winners = [attempt for attempt in body["tries"] if attempt["meets_difficulty"]]
    assert [attempt["nonce"] for attempt in winners] == [GENESIS_BLOCK.nonce]
    assert body["best"]["hash"] == GENESIS_HASH


def test_nonce_explorer_bounds(lab: TestClient) -> None:
    assert lab.post(f"{API}/nonces", json={"header": GENESIS, "count": 65}).status_code == 422
    near_end = lab.post(
        f"{API}/nonces", json={"header": GENESIS, "start_nonce": 2**32 - 2, "count": 10}
    )
    assert len(near_end.json()["tries"]) == 2  # never wraps past the 32-bit nonce space


def test_presets_are_real_blocks(lab: TestClient) -> None:
    presets = lab.get(f"{API}/presets").json()
    assert [preset["key"] for preset in presets] == ["genesis", "block-1"]
    for preset in presets:
        analysis = lab.post(f"{API}/header", json=preset["header"]).json()
        assert analysis["hash"] == preset["block_hash"]
        assert analysis["meets_target"] is True


def test_limits_endpoint(lab: TestClient) -> None:
    assert lab.get(f"{API}/limits").json() == {
        "max_difficulty_bits": 32,
        "max_job_seconds": 60.0,
        "consent_threshold_seconds": 2.0,
        "nonce_space": 2**32,
        "worker_processes": 1,
    }


def test_competition_endpoint(lab: TestClient) -> None:
    request = {
        "miners": [{"name": "Alpha", "hashrate_hs": 3e12}, {"name": "Beta", "hashrate_hs": 1e12}],
        "difficulty_bits": 40,
        "blocks": 100,
        "seed": 99,
    }
    first = lab.post(f"{API}/competition", json=request).json()
    assert first == lab.post(f"{API}/competition", json=request).json()  # reproducible
    assert first["simulated"] is True
    assert first["seed"] == 99
    assert sum(miner["blocks_won"] for miner in first["miners"]) == 100
    assert first["expected_block_time_seconds"] == pytest.approx(2**40 / 4e12)
    unseeded = lab.post(f"{API}/competition", json={**request, "seed": None}).json()
    assert isinstance(unseeded["seed"], int)


@pytest.mark.parametrize(
    "override",
    [
        {"miners": [{"name": "Solo", "hashrate_hs": 1}]},
        {"miners": [{"name": "A", "hashrate_hs": 1}, {"name": "a", "hashrate_hs": 2}]},
        {"miners": [{"name": "A", "hashrate_hs": 0}, {"name": "B", "hashrate_hs": 2}]},
        {"blocks": 2_001},
    ],
)
def test_competition_validation(lab: TestClient, override: dict[str, Any]) -> None:
    base = {"miners": [{"name": "A", "hashrate_hs": 1}, {"name": "B", "hashrate_hs": 2}]}
    assert lab.post(f"{API}/competition", json={**base, **override}).status_code == 422


# --- Admission control: consent and limits ----------------------------------------------


def test_long_runs_require_explicit_consent(lab: TestClient) -> None:
    response = lab.post(f"{API}/jobs", json={"difficulty_bits": 8, "max_seconds": 10})
    assert response.status_code == 403
    error = response.json()["error"]
    assert error["code"] == "permission_required"
    assert error["details"] == [
        {
            "reason": "intensive_workload",
            "max_seconds": 10.0,
            "threshold_seconds": 2.0,
            "cpu_cores": 1,
        }
    ]
    assert activity_messages(lab) == []  # nothing ran, nothing logged


def test_benchmarks_always_require_consent(lab: TestClient) -> None:
    response = lab.post(f"{API}/jobs", json={"kind": "benchmark", "max_seconds": 0.5})
    assert response.status_code == 403
    assert "benchmark" in response.json()["error"]["message"].lower()


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"difficulty_bits": 33, "max_seconds": 1}, "difficulty_bits"),
        ({"difficulty_bits": 8, "max_seconds": 61, "consent": True}, "max_seconds"),
    ],
)
def test_server_limits_are_enforced(lab: TestClient, payload: dict[str, Any], field: str) -> None:
    response = lab.post(f"{API}/jobs", json=payload)
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "resource_limit_exceeded"
    assert error["details"][0]["field"] == field


def test_unknown_fields_are_rejected(lab: TestClient) -> None:
    response = lab.post(f"{API}/jobs", json={"difficulty_bits": 8, "threads": 64})
    assert response.status_code == 422


# --- Job lifecycle ---------------------------------------------------------------------------


def test_short_mining_run_finds_a_verifiable_block(lab: TestClient) -> None:
    started = lab.post(f"{API}/jobs", json={"difficulty_bits": 10, "max_seconds": 2})
    assert started.status_code == 202
    job = wait_finished(lab, started.json()["id"])

    assert job["status"] == "succeeded"
    assert job["simulated"] is True
    assert job["consent"] is False
    assert job["expected_attempts"] == 1024
    # Verify the claimed block independently.
    value = double_sha_value(GENESIS, job["found_nonce"])
    assert value < 2 ** (256 - 10)
    assert job["found_hash"] == value.to_bytes(32, "big").hex()
    assert job["attempts"] == job["found_nonce"] + 1  # searched from nonce 0
    assert job["hash_rate_hs"] > 0
    assert job["best_zero_bits"] >= 10

    entries = activity_messages(lab)
    assert entries[0]["message"].startswith("Simulated block found: nonce")
    assert entries[0]["actor"] == "user"
    assert entries[1]["message"] == "Mining simulation started: 10-bit difficulty, up to 2 s"
    assert entries[1]["detail"] == "Short run below the consent threshold."


def test_consented_run_is_audited(lab: TestClient) -> None:
    job_id = lab.post(
        f"{API}/jobs", json={"difficulty_bits": 6, "max_seconds": 5, "consent": True}
    ).json()["id"]
    wait_finished(lab, job_id)
    started_entry = activity_messages(lab)[1]
    assert started_entry["detail"] == "Explicit consent given to use one CPU core for up to 5 s."
    assert started_entry["context"] == {"job_id": job_id, "kind": "mine", "consent": True}


def test_run_times_out_at_its_limit(lab: TestClient) -> None:
    job_id = lab.post(f"{API}/jobs", json={"difficulty_bits": 32, "max_seconds": 0.6}).json()["id"]
    job = wait_finished(lab, job_id)
    assert job["status"] == "timed_out"
    assert 0.6 <= job["elapsed_seconds"] < 2.0
    assert job["found_nonce"] is None
    assert job["best_hash"] is not None
    assert "reached its 0.6 s limit" in activity_messages(lab)[0]["message"]


def test_run_exhausts_the_nonce_space(lab: TestClient) -> None:
    job_id = lab.post(
        f"{API}/jobs", json={"difficulty_bits": 30, "max_seconds": 2, "start_nonce": 2**32 - 1_500}
    ).json()["id"]
    job = wait_finished(lab, job_id)
    assert job["status"] == "exhausted"
    assert job["attempts"] == 1_500


def test_benchmark_measures_hash_rate(lab: TestClient) -> None:
    job_id = lab.post(
        f"{API}/jobs", json={"kind": "benchmark", "max_seconds": 0.5, "consent": True}
    ).json()["id"]
    job = wait_finished(lab, job_id)
    assert job["status"] == "succeeded"
    assert job["kind"] == "benchmark"
    assert job["expected_attempts"] == 0
    assert job["found_nonce"] is None
    assert job["hash_rate_hs"] > 1_000
    assert activity_messages(lab)[0]["message"].startswith("Benchmark complete:")


def test_one_run_at_a_time_and_cancellation(lab: TestClient) -> None:
    long_run = {"difficulty_bits": 32, "max_seconds": 30, "consent": True}
    job_id = lab.post(f"{API}/jobs", json=long_run).json()["id"]

    busy = lab.post(f"{API}/jobs", json={"difficulty_bits": 4, "max_seconds": 1})
    assert busy.status_code == 409
    assert busy.json()["error"]["details"] == [{"job_id": job_id}]

    asked = time.monotonic()
    cancelled = lab.post(f"{API}/jobs/{job_id}/cancel").json()
    assert time.monotonic() - asked < 2.0
    assert cancelled["status"] == "cancelled"
    assert lab.get(f"{API}/jobs/{job_id}").json()["status"] == "cancelled"
    assert activity_messages(lab)[0]["message"].startswith("HashLab run cancelled after")
    # The slot is free again.
    assert lab.post(f"{API}/jobs", json={"difficulty_bits": 4, "max_seconds": 1}).status_code == 202


def test_cancelling_a_finished_run_returns_it_unchanged(lab: TestClient) -> None:
    job_id = lab.post(f"{API}/jobs", json={"difficulty_bits": 4, "max_seconds": 1}).json()["id"]
    finished = wait_finished(lab, job_id)
    assert lab.post(f"{API}/jobs/{job_id}/cancel").json() == finished


def test_unknown_and_malformed_job_ids(lab: TestClient) -> None:
    assert lab.get(f"{API}/jobs/{'0' * 32}").status_code == 404
    assert lab.post(f"{API}/jobs/{'0' * 32}/cancel").status_code == 404
    assert lab.get(f"{API}/jobs/not-an-id").status_code == 422


def test_recent_runs_are_listed_newest_first(lab: TestClient) -> None:
    ids = []
    for bits in (3, 4, 5):
        job_id = lab.post(f"{API}/jobs", json={"difficulty_bits": bits, "max_seconds": 1}).json()[
            "id"
        ]
        wait_finished(lab, job_id)
        ids.append(job_id)
    listed = lab.get(f"{API}/jobs", params={"limit": 2}).json()
    assert [job["id"] for job in listed] == [ids[2], ids[1]]
    assert lab.get(f"{API}/jobs", params={"limit": 51}).status_code == 422


def test_progress_is_streamed_on_the_hashlab_topic(lab: TestClient) -> None:
    with lab.websocket_connect("/ws/v1") as ws:
        ws.receive_json()  # welcome
        ws.send_json({"action": "subscribe", "topics": ["hashlab"]})
        assert ws.receive_json()["kind"] == "ack"
        idle = ws.receive_json()
        assert idle["type"] == "job.update"
        assert idle["data"] == {"job": None}

        job_id = lab.post(f"{API}/jobs", json={"difficulty_bits": 32, "max_seconds": 0.8}).json()[
            "id"
        ]
        statuses = []
        for _ in range(100):
            event = ws.receive_json()
            job = event["data"]["job"]
            assert job["id"] == job_id
            assert job["simulated"] is True
            statuses.append(job["status"])
            if job["status"] == "timed_out":
                break
    assert statuses[0] == "running"
    assert statuses[-1] == "timed_out"
    assert len(statuses) >= 3  # intermediate progress updates, not just start/finish


# --- Robustness -------------------------------------------------------------------------------


def test_shutdown_cancels_and_records_an_active_run(tmp_path: Any) -> None:
    settings = make_settings(database_path=tmp_path / "shutdown.db")
    with TestClient(create_app(settings, hashlab_executor_factory=thread_executor)) as client:
        job_id = client.post(
            f"{API}/jobs", json={"difficulty_bits": 32, "max_seconds": 30, "consent": True}
        ).json()["id"]
        time.sleep(0.3)
    with TestClient(create_app(settings, hashlab_executor_factory=thread_executor)) as client:
        job = client.get(f"{API}/jobs/{job_id}").json()
    assert job["status"] == "cancelled"
    assert job["finished_at"] is not None


def test_runs_left_running_by_a_crash_are_marked_interrupted(tmp_path: Any) -> None:
    settings = make_settings(database_path=tmp_path / "crash.db")
    app = create_app(settings, hashlab_executor_factory=thread_executor)
    with TestClient(app) as client:
        jobs: HashLabJobs = client.app.state.hashlab  # type: ignore[attr-defined]
        assert client.portal is not None

        async def insert_orphan() -> None:
            async with jobs._sessions() as session, session.begin():
                session.add(
                    SimulationRun(
                        id="f" * 32,
                        kind=JobKind.MINE,
                        status=JobStatus.RUNNING,
                        difficulty_bits=20,
                        max_seconds=5,
                        consent=False,
                        header=GENESIS,
                        start_nonce=0,
                        attempts=0,
                        elapsed_seconds=0.0,
                        created_at=datetime.now(UTC),
                    )
                )

        client.portal.call(insert_orphan)

    # Simulate the next start after a crash.
    with TestClient(create_app(settings, hashlab_executor_factory=thread_executor)) as client:
        orphan = client.get(f"{API}/jobs/{'f' * 32}").json()
        warning = activity_messages(client)[0]
    assert orphan["status"] == "failed"
    assert orphan["error"] == INTERRUPTED_ERROR
    assert warning["level"] == "warning"
    assert warning["message"] == "1 simulation run was interrupted by a restart"


def test_real_worker_process(tmp_path: Any) -> None:
    """The production path: a spawned, low-priority worker process."""
    app = create_app(make_settings(database_path=tmp_path / "proc.db"))
    with TestClient(app) as client:
        job_id = client.post(f"{API}/jobs", json={"difficulty_bits": 12, "max_seconds": 2}).json()[
            "id"
        ]
        job = wait_finished(client, job_id, timeout=30)
    assert job["status"] == "succeeded"
    assert double_sha_value(GENESIS, job["found_nonce"]) < 2 ** (256 - 12)


@pytest.mark.parametrize(
    ("rate", "text"),
    [
        (None, "n/a"),
        (0, "n/a"),
        (950, "950 H/s"),
        (1_500, "1.50 kH/s"),
        (1.3e6, "1.30 MH/s"),
        (2e14, "200.00 TH/s"),
    ],
)
def test_format_rate(rate: float | None, text: str) -> None:
    assert format_rate(rate) == text


def test_worker_failure_fails_the_run_cleanly(
    lab: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken_search(*_args: object) -> None:
        raise MemoryError("worker died")

    monkeypatch.setattr("nexus_hash.modules.hashlab.jobs.search_nonces", broken_search)
    job_id = lab.post(f"{API}/jobs", json={"difficulty_bits": 8, "max_seconds": 1}).json()["id"]
    job = wait_finished(lab, job_id)
    assert job["status"] == "failed"
    assert job["error"] == "The simulation worker failed: MemoryError."
    assert "worker died" not in str(job)  # internals stay in the server log
    entry = activity_messages(lab)[0]
    assert entry["level"] == "error"
    assert entry["message"] == "HashLab run failed"
    # The lab is usable again and the server is healthy.
    monkeypatch.undo()
    assert lab.post(f"{API}/jobs", json={"difficulty_bits": 4, "max_seconds": 1}).status_code == 202
    assert lab.get("/api/v1/system/health").json()["status"] == "ok"


def test_benchmark_wraps_around_the_nonce_space(lab: TestClient) -> None:
    job_id = lab.post(
        f"{API}/jobs",
        json={"kind": "benchmark", "max_seconds": 0.5, "consent": True, "start_nonce": 2**32 - 500},
    ).json()["id"]
    job = wait_finished(lab, job_id)
    assert job["status"] == "succeeded"
    assert job["attempts"] > 500  # kept measuring after wrapping to nonce 0
