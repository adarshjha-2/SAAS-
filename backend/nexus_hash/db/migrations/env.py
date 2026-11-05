"""Alembic environment.

Used both programmatically (``nexus_hash.db.migrate`` passes an open
connection) and from the Alembic CLI (``uv run alembic ...`` in backend/),
where the URL comes from the application settings.
"""

from __future__ import annotations

from alembic import context
from sqlalchemy import Connection, create_engine
from sqlalchemy.pool import NullPool

from nexus_hash.core.config import get_settings
from nexus_hash.db.base import Base
from nexus_hash.modules.activity import models as _activity_models  # noqa: F401 (registers tables)

target_metadata = Base.metadata


def _configure_and_run(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_as_batch=True,  # SQLite needs batch mode for ALTER TABLE
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def _url() -> str:
    url = context.config.get_main_option("sqlalchemy.url")
    return url or get_settings().database_sync_url


def run_migrations_online() -> None:
    connection = context.config.attributes.get("connection")
    if connection is not None:
        _configure_and_run(connection)
        return
    engine = create_engine(_url(), poolclass=NullPool)
    try:
        with engine.begin() as new_connection:
            _configure_and_run(new_connection)
    finally:
        engine.dispose()


if context.is_offline_mode():
    context.configure(
        url=_url(), target_metadata=target_metadata, literal_binds=True, render_as_batch=True
    )
    with context.begin_transaction():
        context.run_migrations()
else:
    run_migrations_online()
