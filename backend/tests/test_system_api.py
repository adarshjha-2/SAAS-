from __future__ import annotations

from fastapi.testclient import TestClient

from nexus_hash import __version__
from nexus_hash.core.catalog import MODULES, ModuleStatus
from nexus_hash.main import create_app
from tests.conftest import make_settings

EXPECTED_MODULES = {
    "command",
    "hashlab",
    "hardware",
    "network",
    "profitability",
    "intelligence",
    "core",
}


def test_health_ok_when_running(client: TestClient) -> None:
    response = client.get("/api/v1/system/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["version"] == __version__
    assert body["environment"] == "test"
    assert body["checks"] == {"api": "ok", "realtime": "ok", "database": "ok"}
    assert body["uptime_seconds"] >= 0


def test_health_degraded_without_background_tasks() -> None:
    # Without entering the context manager the lifespan never starts the heartbeat.
    client = TestClient(create_app(make_settings()))
    body = client.get("/api/v1/system/health").json()
    assert body["status"] == "degraded"
    assert body["checks"]["realtime"] == "degraded"


def test_info_reports_features_without_secrets() -> None:
    secret = "sk-ant-should-never-leak-123456"
    app = create_app(make_settings(anthropic_api_key=secret))
    with TestClient(app) as client:
        response = client.get("/api/v1/system/info")
    assert response.status_code == 200
    assert secret not in response.text
    body = response.json()
    assert body["name"] == "NEXUS HASH AI"
    assert body["tagline"] == "Intelligence Beyond Computational Limits."
    assert body["api_version"] == "v1"
    assert body["features"] == {"llm_configured": True, "docs_enabled": True}
    assert body["realtime"]["path"] == "/ws/v1"
    assert "system" in body["realtime"]["topics"]
    assert len(body["disclaimers"]) == 3
    assert any("never submitted to the Bitcoin network" in d for d in body["disclaimers"])


def test_info_llm_not_configured_by_default(client: TestClient) -> None:
    assert client.get("/api/v1/system/info").json()["features"]["llm_configured"] is False


def test_module_catalog(client: TestClient) -> None:
    response = client.get("/api/v1/system/modules")
    assert response.status_code == 200
    modules = response.json()
    keys = [module["key"] for module in modules]
    assert set(keys) == EXPECTED_MODULES
    assert len(keys) == len(set(keys))
    valid_statuses = {status.value for status in ModuleStatus}
    for module in modules:
        assert module["status"] in valid_statuses
        assert 2 <= module["milestone"] <= 10
        assert module["summary"]


def test_catalog_milestones_are_ordered() -> None:
    milestones = [module.milestone for module in MODULES]
    assert milestones == sorted(milestones)


def test_delivered_modules_are_online() -> None:
    online = {module.key for module in MODULES if module.status is ModuleStatus.ONLINE}
    assert online == {"command", "hashlab", "hardware"}


def test_get_single_module(client: TestClient) -> None:
    response = client.get("/api/v1/system/modules/hashlab")
    assert response.status_code == 200
    assert response.json()["name"] == "HashLab"


def test_unknown_module_returns_error_envelope(client: TestClient) -> None:
    response = client.get("/api/v1/system/modules/quantum-miner")
    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "not_found"
    assert "quantum-miner" in error["message"]
    assert error["request_id"] == response.headers["x-request-id"]


def test_docs_available_in_development(client: TestClient) -> None:
    assert client.get("/docs").status_code == 200
    assert client.get("/openapi.json").status_code == 200


def test_docs_hidden_in_production() -> None:
    with TestClient(create_app(make_settings(environment="production"))) as client:
        assert client.get("/docs").status_code == 404
        assert client.get("/openapi.json").status_code == 404
        assert client.get("/api/v1/system/health").status_code == 200
