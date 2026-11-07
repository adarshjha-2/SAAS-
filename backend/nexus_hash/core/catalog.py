"""Catalog of NEXUS HASH AI product modules and their delivery status.

This is the single source of truth the frontend uses to render navigation and
readiness. A module is only marked ``online`` once its milestone is
implemented *and* tested - the UI must never present an unbuilt module as
working.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict


class ModuleStatus(StrEnum):
    PLANNED = "planned"
    IN_DEVELOPMENT = "in_development"
    ONLINE = "online"


class ModuleDescriptor(BaseModel):
    model_config = ConfigDict(frozen=True)

    key: str
    name: str
    summary: str
    milestone: int
    status: ModuleStatus
    api_prefix: str | None = None


MODULES: tuple[ModuleDescriptor, ...] = (
    ModuleDescriptor(
        key="command",
        name="Nexus Command",
        summary=(
            "Central command dashboard: system, hardware, simulation and network status, "
            "analytics charts, AI recommendations and the activity log."
        ),
        milestone=2,
        status=ModuleStatus.ONLINE,
    ),
    ModuleDescriptor(
        key="hashlab",
        name="HashLab",
        summary=(
            "Educational proof-of-work simulator: SHA-256, block headers, nonces, configurable "
            "difficulty and simulated mining competitions. Never touches the Bitcoin network."
        ),
        milestone=4,
        status=ModuleStatus.ONLINE,
        api_prefix="/api/v1/hashlab",
    ),
    ModuleDescriptor(
        key="hardware",
        name="Hardware Intelligence",
        summary=(
            "Read-only monitoring of CPU, GPU, memory, temperatures and power where the "
            "platform exposes them."
        ),
        milestone=5,
        status=ModuleStatus.ONLINE,
        api_prefix="/api/v1/hardware",
    ),
    ModuleDescriptor(
        key="network",
        name="Bitcoin Network Intelligence",
        summary=(
            "Live price, difficulty, block height, block reward, network hash rate and mempool "
            "statistics from public APIs, with caching and graceful degradation."
        ),
        milestone=6,
        status=ModuleStatus.PLANNED,
    ),
    ModuleDescriptor(
        key="profitability",
        name="Profitability Intelligence",
        summary=(
            "Scenario-based mining revenue, electricity cost and break-even estimates with "
            "explicit assumptions and uncertainty ranges. Never a guarantee of earnings."
        ),
        milestone=7,
        status=ModuleStatus.PLANNED,
    ),
    ModuleDescriptor(
        key="intelligence",
        name="Nexus Intelligence",
        summary=(
            "Analytics engine: performance analysis, inefficiency detection, anomaly detection "
            "and simulated strategy comparison."
        ),
        milestone=8,
        status=ModuleStatus.PLANNED,
    ),
    ModuleDescriptor(
        key="core",
        name="NEXUS CORE",
        summary=(
            "AI assistant grounded in live platform data: explains metrics, analyses efficiency, "
            "flags unusual changes, writes reports and suggests safe configuration changes."
        ),
        milestone=8,
        status=ModuleStatus.PLANNED,
    ),
)


def get_module(key: str) -> ModuleDescriptor | None:
    return next((module for module in MODULES if module.key == key), None)
