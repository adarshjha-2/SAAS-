"""Command-line entrypoint: ``nexus-hash`` or ``python -m nexus_hash``."""

from __future__ import annotations

import argparse
import sys

import uvicorn
from pydantic import ValidationError

from nexus_hash import APP_NAME, __version__
from nexus_hash.core.config import get_settings


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="nexus-hash", description=f"{APP_NAME} API server")
    parser.add_argument("--reload", action="store_true", help="auto-reload on code changes (dev)")
    parser.add_argument("--version", action="version", version=f"{APP_NAME} {__version__}")
    args = parser.parse_args(argv)

    try:
        settings = get_settings()
    except ValidationError as exc:
        # Configuration errors are user-facing: print them plainly, no traceback.
        print(f"Invalid configuration:\n{exc}", file=sys.stderr)
        raise SystemExit(2) from None

    uvicorn.run(
        "nexus_hash.main:create_app",
        factory=True,
        host=settings.host,
        port=settings.port,
        reload=args.reload,
        log_level=settings.log_level.lower(),
        access_log=False,
        server_header=False,
        ws_max_size=settings.ws_max_message_bytes,
    )


if __name__ == "__main__":
    main()
