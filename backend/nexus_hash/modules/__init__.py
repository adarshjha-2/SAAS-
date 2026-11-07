"""Domain modules. Each milestone adds one package here with the same shape:

    modules/<name>/
        schemas.py   Pydantic request/response models (the API contract)
        service.py   Domain logic; no FastAPI imports, unit-testable in isolation
        router.py    Thin FastAPI router that validates input and calls the service
        providers.py Optional adapters for external systems (APIs, hardware libs)

Modules may depend on ``nexus_hash.core`` but never on each other's internals;
cross-module data flows through services or the realtime hub.
"""
