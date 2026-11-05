"""Shared FastAPI dependencies."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request

from nexus_hash.core.config import Settings
from nexus_hash.core.realtime import RealtimeHub


def get_app_settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def get_hub(request: Request) -> RealtimeHub:
    hub: RealtimeHub = request.app.state.hub
    return hub


SettingsDep = Annotated[Settings, Depends(get_app_settings)]
HubDep = Annotated[RealtimeHub, Depends(get_hub)]
