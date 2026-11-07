"""Typed, validated application configuration.

All configuration comes from environment variables (prefix ``NEXUS_``) or an
optional ``.env`` file. Secrets are held as :class:`pydantic.SecretStr` so they
never appear in ``repr()``, logs, or serialized responses.

Security defaults:

* The server binds to loopback only. Binding to any other interface requires
  ``NEXUS_ALLOW_REMOTE_ACCESS=true`` - an explicit, visible opt-in.
* CORS is an explicit allowlist; wildcards are rejected.
* Interactive API docs are disabled in production unless explicitly enabled.
"""

from __future__ import annotations

import ipaddress
import re
from enum import StrEnum
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any, Literal, Self

from pydantic import AliasChoices, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

_ORIGIN_RE = re.compile(r"^https?://[A-Za-z0-9.\-\[\]:]+(:\d{1,5})?$")
_LOOPBACK_HOSTNAMES = frozenset({"localhost"})


class Environment(StrEnum):
    DEVELOPMENT = "development"
    TEST = "test"
    PRODUCTION = "production"


def _is_loopback(host: str) -> bool:
    if host in _LOOPBACK_HOSTNAMES:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


class Settings(BaseSettings):
    """Runtime settings. Instances are immutable once constructed."""

    model_config = SettingsConfigDict(
        env_prefix="NEXUS_",
        # Repo-root .env first, then backend/.env (later files take priority).
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        env_ignore_empty=True,  # `KEY=` in .env means "use the default"
        extra="ignore",
        frozen=True,
    )

    environment: Environment = Environment.DEVELOPMENT

    # --- Network binding -------------------------------------------------
    host: str = "127.0.0.1"
    port: int = Field(default=8000, ge=1024, le=65535)
    allow_remote_access: bool = False

    # --- Logging ----------------------------------------------------------
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    log_format: Literal["console", "json"] = "console"

    # --- HTTP -------------------------------------------------------------
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"],
    )
    docs_enabled: bool | None = None
    max_request_body_bytes: int = Field(default=1_048_576, ge=1_024, le=50 * 1_048_576)

    # --- Realtime (WebSocket) ---------------------------------------------
    ws_max_connections: int = Field(default=32, ge=1, le=1_024)
    ws_heartbeat_seconds: float = Field(default=5.0, ge=0.05, le=300.0)
    ws_client_queue_size: int = Field(default=256, ge=8, le=10_000)
    ws_max_message_bytes: int = Field(default=4_096, ge=256, le=65_536)

    # --- Persistence (SQLite) ---------------------------------------------
    # Relative paths resolve against the server's working directory (backend/).
    database_path: Path = Path("data/nexus_hash.db")
    db_auto_migrate: bool = True
    activity_retention_days: int = Field(default=30, ge=1, le=3_650)
    activity_max_entries: int = Field(default=50_000, ge=100, le=5_000_000)
    retention_interval_seconds: float = Field(default=3_600.0, ge=0.05, le=86_400.0)

    # --- HashLab (ADR 0002: workload safety) --------------------------------
    hashlab_max_difficulty_bits: int = Field(default=32, ge=8, le=40)
    hashlab_max_job_seconds: float = Field(default=60.0, ge=1.0, le=600.0)
    # Jobs that may use one CPU core for longer than this need explicit consent.
    hashlab_consent_threshold_seconds: float = Field(default=2.0, ge=0.0, le=60.0)

    # --- Hardware Intelligence (read-only monitoring) ----------------------
    hardware_monitoring_enabled: bool = True
    hardware_sample_seconds: float = Field(default=2.0, ge=0.5, le=60.0)
    hardware_persist_seconds: float = Field(default=60.0, ge=10.0, le=3_600.0)
    hardware_retention_days: int = Field(default=7, ge=1, le=365)

    # --- Secrets (backend only; never sent to the frontend) ----------------
    anthropic_api_key: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices("NEXUS_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY"),
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: Any) -> Any:
        if isinstance(value, str):
            return [part.strip() for part in value.split(",") if part.strip()]
        return value

    @field_validator("cors_origins")
    @classmethod
    def _validate_origins(cls, origins: list[str]) -> list[str]:
        cleaned: list[str] = []
        for origin in origins:
            if origin == "*":
                raise ValueError("wildcard CORS origins are not permitted; list origins explicitly")
            normalized = origin.rstrip("/")
            if not _ORIGIN_RE.fullmatch(normalized):
                raise ValueError(f"invalid CORS origin {origin!r}; expected scheme://host[:port]")
            cleaned.append(normalized)
        return cleaned

    @field_validator("database_path")
    @classmethod
    def _validate_database_path(cls, value: Path) -> Path:
        if str(value) in {"", ":memory:"} or value.name.startswith("file:"):
            raise ValueError(
                "database_path must be a file path (in-memory databases are not supported)"
            )
        if value.exists() and value.is_dir():
            raise ValueError(f"database_path {str(value)!r} is a directory")
        return value

    @field_validator("anthropic_api_key")
    @classmethod
    def _blank_secret_is_none(cls, value: SecretStr | None) -> SecretStr | None:
        if value is not None and not value.get_secret_value().strip():
            return None
        return value

    @model_validator(mode="after")
    def _enforce_binding_policy(self) -> Self:
        if not _is_loopback(self.host) and not self.allow_remote_access:
            raise ValueError(
                f"refusing to bind to non-loopback host {self.host!r}: "
                "set NEXUS_ALLOW_REMOTE_ACCESS=true to expose the API beyond this machine"
            )
        return self

    # --- Derived values ---------------------------------------------------
    @property
    def is_production(self) -> bool:
        return self.environment is Environment.PRODUCTION

    @property
    def api_docs_enabled(self) -> bool:
        if self.docs_enabled is not None:
            return self.docs_enabled
        return not self.is_production

    @property
    def database_url(self) -> str:
        """Async SQLAlchemy URL used by the application."""
        return f"sqlite+aiosqlite:///{self.database_path.expanduser()}"

    @property
    def database_sync_url(self) -> str:
        """Synchronous URL used by Alembic migrations."""
        return f"sqlite:///{self.database_path.expanduser()}"

    @property
    def llm_configured(self) -> bool:
        return self.anthropic_api_key is not None

    def secret_values(self) -> list[str]:
        """Raw secret values, used only to scrub them from log output."""
        secrets: list[str] = []
        if self.anthropic_api_key is not None:
            secrets.append(self.anthropic_api_key.get_secret_value())
        return secrets


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Process-wide settings loaded from the environment."""
    return Settings()
