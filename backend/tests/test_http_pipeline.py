"""Error envelope, request correlation, security headers, CORS and body limits."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi import FastAPI, Query, Request
from fastapi.testclient import TestClient

from nexus_hash.core.errors import (
    INTERNAL_ERROR_MESSAGE,
    PermissionRequiredError,
    ResourceLimitError,
    UpstreamUnavailableError,
)
from nexus_hash.main import create_app
from tests.conftest import TEST_ORIGIN, make_settings

BODY_LIMIT = 2_048


@pytest.fixture
def pipeline_app() -> FastAPI:
    app = create_app(make_settings(max_request_body_bytes=BODY_LIMIT))

    @app.get("/api/v1/_test/validated")
    async def validated(count: int = Query(ge=1, le=10)) -> dict[str, int]:
        return {"count": count}

    @app.get("/api/v1/_test/crash")
    async def crash() -> None:
        raise RuntimeError("database password is hunter2")

    @app.get("/api/v1/_test/consent")
    async def consent() -> None:
        raise PermissionRequiredError("Benchmark requires explicit consent.")

    @app.get("/api/v1/_test/limit")
    async def limit() -> None:
        raise ResourceLimitError("Difficulty exceeds the simulator limit.", details=[{"max": 32}])

    @app.get("/api/v1/_test/upstream")
    async def upstream() -> None:
        raise UpstreamUnavailableError("mempool.space is unreachable.")

    @app.post("/api/v1/_test/upload")
    async def upload(request: Request) -> dict[str, int]:
        return {"received": len(await request.body())}

    return app


@pytest.fixture
def pclient(pipeline_app: FastAPI) -> Iterator[TestClient]:
    with TestClient(pipeline_app, raise_server_exceptions=False) as client:
        yield client


def test_unknown_route_uses_envelope(pclient: TestClient) -> None:
    response = pclient.get("/api/v1/does-not-exist")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_method_not_allowed_uses_envelope(pclient: TestClient) -> None:
    response = pclient.delete("/api/v1/system/health")
    assert response.status_code == 405
    assert response.json()["error"]["code"] == "method_not_allowed"


def test_validation_error_is_sanitized(pclient: TestClient) -> None:
    response = pclient.get("/api/v1/_test/validated", params={"count": "999"})
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert error["details"][0]["loc"] == ["query", "count"]
    assert set(error["details"][0]) == {"loc", "msg", "type"}  # no echoed input


def test_unhandled_exception_hides_internals(pclient: TestClient) -> None:
    response = pclient.get("/api/v1/_test/crash")
    assert response.status_code == 500
    assert "hunter2" not in response.text
    assert "RuntimeError" not in response.text
    error = response.json()["error"]
    assert error == {
        "code": "internal_error",
        "message": INTERNAL_ERROR_MESSAGE,
        "request_id": response.headers["x-request-id"],
    }
    # Security headers still apply to failure responses.
    assert response.headers["x-content-type-options"] == "nosniff"


@pytest.mark.parametrize(
    ("path", "status", "code"),
    [
        ("/api/v1/_test/consent", 403, "permission_required"),
        ("/api/v1/_test/limit", 422, "resource_limit_exceeded"),
        ("/api/v1/_test/upstream", 503, "upstream_unavailable"),
    ],
)
def test_app_errors_map_to_status_and_code(
    pclient: TestClient, path: str, status: int, code: str
) -> None:
    response = pclient.get(path)
    assert response.status_code == status
    assert response.json()["error"]["code"] == code


def test_app_error_details_are_returned(pclient: TestClient) -> None:
    assert pclient.get("/api/v1/_test/limit").json()["error"]["details"] == [{"max": 32}]


def test_valid_inbound_request_id_is_propagated(pclient: TestClient) -> None:
    response = pclient.get("/api/v1/system/health", headers={"x-request-id": "trace-abc.123"})
    assert response.headers["x-request-id"] == "trace-abc.123"


@pytest.mark.parametrize("bad_id", ["has spaces", "x" * 200, "<script>", ""])
def test_invalid_inbound_request_id_is_replaced(pclient: TestClient, bad_id: str) -> None:
    response = pclient.get("/api/v1/system/health", headers={"x-request-id": bad_id})
    generated = response.headers["x-request-id"]
    assert generated != bad_id
    assert len(generated) == 32


def test_security_headers_on_api_responses(pclient: TestClient) -> None:
    headers = pclient.get("/api/v1/system/health").headers
    assert headers["x-frame-options"] == "DENY"
    assert headers["referrer-policy"] == "no-referrer"
    assert headers["cache-control"] == "no-store"
    assert headers["content-security-policy"].startswith("default-src 'none'")
    assert "server-timing" in headers


def test_docs_page_exempt_from_strict_csp(pclient: TestClient) -> None:
    response = pclient.get("/docs")
    assert response.status_code == 200
    assert "content-security-policy" not in response.headers
    assert response.headers["x-frame-options"] == "DENY"


def test_cors_preflight_allowed_origin(pclient: TestClient) -> None:
    response = pclient.options(
        "/api/v1/system/health",
        headers={"origin": TEST_ORIGIN, "access-control-request-method": "GET"},
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == TEST_ORIGIN


def test_cors_disallowed_origin_gets_no_grant(pclient: TestClient) -> None:
    response = pclient.get("/api/v1/system/health", headers={"origin": "https://evil.test"})
    assert "access-control-allow-origin" not in response.headers


def test_body_within_limit_accepted(pclient: TestClient) -> None:
    response = pclient.post("/api/v1/_test/upload", content=b"x" * BODY_LIMIT)
    assert response.status_code == 200
    assert response.json() == {"received": BODY_LIMIT}


def test_declared_oversize_body_rejected(pclient: TestClient) -> None:
    response = pclient.post("/api/v1/_test/upload", content=b"x" * (BODY_LIMIT + 1))
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"


def test_chunked_oversize_body_rejected(pclient: TestClient) -> None:
    def chunks() -> Iterator[bytes]:
        for _ in range(4):
            yield b"x" * 1_024

    response = pclient.post("/api/v1/_test/upload", content=chunks())
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"


def test_malformed_content_length_rejected(pclient: TestClient) -> None:
    response = pclient.post(
        "/api/v1/_test/upload", content=b"abc", headers={"content-length": "abc"}
    )
    assert response.status_code == 400
