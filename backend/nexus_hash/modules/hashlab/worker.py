"""The nonce search that runs inside the HashLab worker process.

Top-level, dependency-free functions so they can be pickled into a spawned
process. Work is done in bounded chunks: the job runner in the server decides
whether to continue after each chunk, which is how cancellation, progress
reporting and the wall-clock limit are enforced without shared state.
"""

from __future__ import annotations

import hashlib
import os
import time
from dataclasses import dataclass

_TIME_CHECK_MASK = 0x3FF  # check the clock every 1,024 hashes


@dataclass(frozen=True)
class ChunkResult:
    attempts: int
    elapsed: float
    found_nonce: int | None
    best_nonce: int
    best_value: int


def lower_priority() -> None:
    """Process initializer: run below normal priority so the UI and API stay responsive."""
    if hasattr(os, "nice"):
        os.nice(10)


def search_nonces(
    prefix: bytes, start: int, count: int, target: int, time_budget: float
) -> ChunkResult:
    """Try nonces start..start+count-1; stop at the first hash below `target`
    or when `time_budget` seconds have elapsed.

    Uses the standard SHA-256 midstate technique: the first 64 header bytes
    never change between nonces, so their compression is computed once and
    copied. Every candidate is still fully double-hashed - no work is skipped.
    """
    if len(prefix) != 76:  # noqa: PLR2004 - header without its 4-byte nonce
        raise ValueError("prefix must be the 76-byte header without the nonce")
    if count <= 0:
        return ChunkResult(0, 0.0, None, start, 1 << 256)
    sha256 = hashlib.sha256
    copy_midstate = sha256(prefix[:64]).copy
    from_bytes = int.from_bytes
    perf_counter = time.perf_counter
    tail = prefix[64:]
    started = perf_counter()
    deadline = started + time_budget
    best_value = 1 << 256
    best_nonce = start
    end = start + count
    attempts = 0

    for nonce in range(start, end):
        inner = copy_midstate()
        inner.update(tail + nonce.to_bytes(4, "little"))
        value = from_bytes(sha256(inner.digest()).digest(), "little")
        if value < best_value:
            best_value = value
            best_nonce = nonce
            if value < target:
                return ChunkResult(nonce - start + 1, perf_counter() - started, nonce, nonce, value)
        if not nonce & _TIME_CHECK_MASK and perf_counter() >= deadline:
            attempts = nonce - start + 1
            break
    else:
        attempts = count

    return ChunkResult(attempts, perf_counter() - started, None, best_nonce, best_value)
