from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import AliasChoices, ValidationError

from nexus_hash.core.config import Environment, Settings, get_settings
from tests.conftest import make_settings

SECRET = "sk-ant-test-0123456789abcdef"


def test_secure_defaults() -> None:
    settings = make_settings(environment="development")
    assert settings.host == "127.0.0.1"
    assert settings.port == 8000
    assert settings.allow_remote_access is False
    assert settings.api_docs_enabled is True
    assert settings.llm_configured is False
    assert "*" not in settings.cors_origins


def test_docs_disabled_in_production_unless_explicit() -> None:
    assert make_settings(environment="production").api_docs_enabled is False
    assert make_settings(environment="production", docs_enabled=True).api_docs_enabled is True
    assert make_settings(environment="development", docs_enabled=False).api_docs_enabled is False


def test_cors_origins_parsed_from_comma_separated_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NEXUS_CORS_ORIGINS", "http://a.test:3000, https://b.test/ ,")
    settings = Settings(_env_file=None)  # type: ignore[call-arg]
    assert settings.cors_origins == ["http://a.test:3000", "https://b.test"]


@pytest.mark.parametrize("origin", ["*", "ftp://files.test", "http://a.test/path", "a.test"])
def test_invalid_cors_origins_rejected(origin: str) -> None:
    with pytest.raises(ValidationError):
        make_settings(cors_origins=[origin])


@pytest.mark.parametrize("host", ["0.0.0.0", "192.168.1.20", "example.com"])  # noqa: S104
def test_non_loopback_bind_requires_explicit_opt_in(host: str) -> None:
    with pytest.raises(ValidationError, match="NEXUS_ALLOW_REMOTE_ACCESS"):
        make_settings(host=host)
    assert make_settings(host=host, allow_remote_access=True).host == host


@pytest.mark.parametrize("host", ["127.0.0.1", "127.0.0.2", "::1", "localhost"])
def test_loopback_hosts_allowed(host: str) -> None:
    assert make_settings(host=host).host == host


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("port", 80),
        ("port", 70000),
        ("ws_heartbeat_seconds", 0),
        ("ws_max_connections", 0),
        ("max_request_body_bytes", 10),
        ("log_level", "TRACE"),
        ("environment", "staging"),
    ],
)
def test_out_of_range_values_rejected(field: str, value: object) -> None:
    with pytest.raises(ValidationError):
        make_settings(**{field: value})


@pytest.mark.parametrize("env_var", ["ANTHROPIC_API_KEY", "NEXUS_ANTHROPIC_API_KEY"])
def test_api_key_read_from_either_env_var(monkeypatch: pytest.MonkeyPatch, env_var: str) -> None:
    monkeypatch.setenv(env_var, SECRET)
    settings = Settings(_env_file=None)  # type: ignore[call-arg]
    assert settings.llm_configured is True
    assert settings.anthropic_api_key is not None
    assert settings.anthropic_api_key.get_secret_value() == SECRET


def test_api_key_never_rendered(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", SECRET)
    settings = Settings(_env_file=None)  # type: ignore[call-arg]
    assert SECRET not in repr(settings)
    assert SECRET not in str(settings)
    assert SECRET not in settings.model_dump_json()


def test_blank_api_key_treated_as_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "   ")
    assert Settings(_env_file=None).llm_configured is False  # type: ignore[call-arg]


def test_settings_are_immutable() -> None:
    settings = make_settings()
    with pytest.raises(ValidationError):
        settings.port = 9000  # type: ignore[misc]


def test_get_settings_is_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NEXUS_ENVIRONMENT", "production")
    monkeypatch.chdir("/")  # ensure no stray .env is picked up
    first = get_settings()
    assert first.environment is Environment.PRODUCTION
    assert get_settings() is first


ENV_EXAMPLE = Path(__file__).resolve().parents[2] / ".env.example"


def test_env_example_is_valid_and_matches_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("NEXUS_DATABASE_PATH")  # compare the file's value, not the test override
    from_example = Settings(_env_file=ENV_EXAMPLE)  # type: ignore[call-arg]
    defaults = Settings(_env_file=None)  # type: ignore[call-arg]
    assert from_example == defaults


def test_env_example_documents_every_setting() -> None:
    text = ENV_EXAMPLE.read_text()
    for name, field in Settings.model_fields.items():
        alias = field.validation_alias
        candidates = (
            [str(choice) for choice in alias.choices]
            if isinstance(alias, AliasChoices)
            else [f"NEXUS_{name.upper()}"]
        )
        assert any(f"{candidate}=" in text for candidate in candidates), name


@pytest.mark.parametrize("path", [":memory:", "file:memdb?mode=memory"])
def test_in_memory_database_rejected(path: str) -> None:
    with pytest.raises(ValidationError, match="in-memory"):
        make_settings(database_path=path)


def test_database_path_must_not_be_a_directory(tmp_path: Path) -> None:
    with pytest.raises(ValidationError, match="is a directory"):
        make_settings(database_path=tmp_path)


def test_database_urls_derive_from_path(tmp_path: Path) -> None:
    settings = make_settings(database_path=tmp_path / "x.db")
    assert settings.database_url == f"sqlite+aiosqlite:///{tmp_path}/x.db"
    assert settings.database_sync_url == f"sqlite:///{tmp_path}/x.db"
