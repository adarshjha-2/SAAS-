from __future__ import annotations

import json
import logging
from typing import Any

import pytest

from nexus_hash import __main__ as cli
from nexus_hash.core.logging import (
    JsonFormatter,
    SecretRedactionFilter,
    configure_logging,
    request_id_var,
)

SECRET = "sk-ant-super-secret-value-42"


def _record(msg: str, *args: object, **extra: Any) -> logging.LogRecord:
    record = logging.LogRecord("nexus_hash.test", logging.INFO, __file__, 1, msg, args, None)
    for key, value in extra.items():
        setattr(record, key, value)
    return record


def test_redaction_filter_scrubs_secrets_in_args() -> None:
    record = _record("calling provider with key=%s", SECRET)
    SecretRedactionFilter([SECRET]).filter(record)
    assert SECRET not in record.getMessage()
    assert "***REDACTED***" in record.getMessage()


def test_redaction_filter_ignores_short_values() -> None:
    record = _record("the word is abc")
    SecretRedactionFilter(["abc"]).filter(record)
    assert record.getMessage() == "the word is abc"


def test_json_formatter_includes_fields_and_request_id() -> None:
    record = _record("served", request_id="req-1", fields={"status": 200})
    payload = json.loads(JsonFormatter().format(record))
    assert payload["message"] == "served"
    assert payload["request_id"] == "req-1"
    assert payload["status"] == 200
    assert payload["level"] == "INFO"


def test_configure_logging_is_idempotent() -> None:
    configure_logging("INFO", "json")
    configure_logging("INFO", "console")
    marked = [h for h in logging.getLogger().handlers if getattr(h, "_nexus_hash_handler", False)]
    assert len(marked) == 1


def test_secret_redacted_end_to_end(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging("INFO", "json", secrets=[SECRET])
    token = request_id_var.set("req-xyz")
    try:
        logging.getLogger("nexus_hash.test").warning("leaking %s by accident", SECRET)
    finally:
        request_id_var.reset(token)
    output = capsys.readouterr().err
    assert SECRET not in output
    line = json.loads(output.strip().splitlines()[-1])
    assert line["request_id"] == "req-xyz"
    configure_logging("WARNING", "console")


def test_cli_version(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as excinfo:
        cli.main(["--version"])
    assert excinfo.value.code == 0
    assert "NEXUS HASH AI" in capsys.readouterr().out


def test_cli_invalid_configuration_exits_cleanly(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("NEXUS_HOST", "0.0.0.0")  # noqa: S104
    monkeypatch.chdir("/")
    with pytest.raises(SystemExit) as excinfo:
        cli.main([])
    assert excinfo.value.code == 2
    assert "NEXUS_ALLOW_REMOTE_ACCESS" in capsys.readouterr().err


def test_cli_starts_uvicorn_with_safe_options(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    def fake_run(target: str, **kwargs: Any) -> None:
        captured["target"] = target
        captured.update(kwargs)

    monkeypatch.chdir("/")
    monkeypatch.setattr(cli.uvicorn, "run", fake_run)
    cli.main([])
    assert captured["target"] == "nexus_hash.main:create_app"
    assert captured["factory"] is True
    assert captured["host"] == "127.0.0.1"
    assert captured["server_header"] is False
    assert captured["ws_max_size"] == 4_096
