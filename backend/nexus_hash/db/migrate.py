"""Run Alembic migrations programmatically (no alembic.ini needed at runtime)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine
from sqlalchemy.pool import NullPool

MIGRATIONS_DIR = Path(__file__).parent / "migrations"


@dataclass(frozen=True)
class MigrationResult:
    before: str | None
    after: str | None

    @property
    def changed(self) -> bool:
        return self.before != self.after


def alembic_config(sync_url: str) -> Config:
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    config.set_main_option("sqlalchemy.url", sync_url)
    return config


def head_revision() -> str | None:
    script = ScriptDirectory.from_config(alembic_config("sqlite://"))
    return script.get_current_head()


def _run(sync_url: str, target: str, upgrade: bool) -> MigrationResult:
    config = alembic_config(sync_url)
    engine = create_engine(sync_url, poolclass=NullPool)
    try:
        with engine.begin() as connection:
            before = MigrationContext.configure(connection).get_current_revision()
            config.attributes["connection"] = connection
            if upgrade:
                command.upgrade(config, target)
            else:
                command.downgrade(config, target)
            after = MigrationContext.configure(connection).get_current_revision()
    finally:
        engine.dispose()
    return MigrationResult(before=before, after=after)


def upgrade_to_head(sync_url: str) -> MigrationResult:
    """Apply all pending migrations. Safe to call on every start."""
    return _run(sync_url, "head", upgrade=True)


def downgrade_to(sync_url: str, target: str) -> MigrationResult:
    return _run(sync_url, target, upgrade=False)


def current_revision(sync_url: str) -> str | None:
    engine = create_engine(sync_url, poolclass=NullPool)
    try:
        with engine.connect() as connection:
            return MigrationContext.configure(connection).get_current_revision()
    finally:
        engine.dispose()
