"""Proof-of-work primitives, the worker search, and the competition model."""

from __future__ import annotations

import hashlib
import math
import random

import pytest

from nexus_hash.modules.hashlab import worker
from nexus_hash.modules.hashlab.competition import MinerSpec, simulate_competition
from nexus_hash.modules.hashlab.pow import (
    BLOCK_1,
    BLOCK_1_HASH,
    GENESIS_BLOCK,
    GENESIS_HASH,
    HEADER_LAYOUT,
    MAX_TARGET,
    BlockHeader,
    bits_to_target,
    difficulty_for_target,
    display_hex,
    hash_to_int,
    leading_zero_bits,
    target_for_zero_bits,
    target_to_bits,
)
from nexus_hash.modules.hashlab.worker import search_nonces


def _full_hash_value(prefix: bytes, nonce: int) -> int:
    """Independent reference: plain double SHA-256, no midstate."""
    digest = hashlib.sha256(hashlib.sha256(prefix + nonce.to_bytes(4, "little")).digest()).digest()
    return int.from_bytes(digest, "little")


# --- Real-chain test vectors ---------------------------------------------------------


@pytest.mark.parametrize(
    ("header", "expected"), [(GENESIS_BLOCK, GENESIS_HASH), (BLOCK_1, BLOCK_1_HASH)]
)
def test_real_block_headers_hash_to_their_published_hashes(
    header: BlockHeader, expected: str
) -> None:
    assert len(header.serialize()) == 80
    assert display_hex(header.hash()) == expected


def test_header_layout_covers_all_80_bytes_in_order() -> None:
    offset = 0
    for _name, field_offset, size in HEADER_LAYOUT:
        assert field_offset == offset
        offset += size
    assert offset == 80


def test_negative_version_serialises_as_signed_int32() -> None:
    header = BlockHeader(-1, "00" * 32, "00" * 32, 0, 0x1D00FFFF, 0)
    assert header.serialize()[:4] == b"\xff\xff\xff\xff"


def test_genesis_block_meets_its_target_with_43_leading_zero_bits() -> None:
    value = hash_to_int(GENESIS_BLOCK.hash())
    assert value <= bits_to_target(GENESIS_BLOCK.bits)
    assert leading_zero_bits(value) == 43


# --- Compact targets ------------------------------------------------------------------


@pytest.mark.parametrize(
    ("bits", "target"),
    [
        (0x1D00FFFF, MAX_TARGET),
        (0x03123456, 0x123456),
        (0x04123456, 0x12345600),
        (0x02008000, 0x80),
        (0x17053894, 0x053894 << (8 * (0x17 - 3))),  # a 2024-era mainnet target
    ],
)
def test_bits_to_target_known_values(bits: int, target: int) -> None:
    assert bits_to_target(bits) == target


@pytest.mark.parametrize(
    ("bits", "reason"),
    [
        (0x1D80FFFF, "negative"),
        (0x1D000000, "mantissa"),
        (0x01003456, "zero"),
        (0xFF123456, "overflow"),
        (2**32, "32-bit"),
        (-1, "32-bit"),
    ],
)
def test_invalid_compact_encodings_are_rejected(bits: int, reason: str) -> None:
    with pytest.raises(ValueError, match=reason):
        bits_to_target(bits)


def test_target_to_bits_roundtrips_to_the_same_precision() -> None:
    rng = random.Random(7)
    for _ in range(500):
        target = rng.getrandbits(rng.randint(1, 255)) or 1
        bits = target_to_bits(target)
        decoded = bits_to_target(bits)
        # The compact form keeps the 3 most significant bytes.
        assert decoded <= target
        assert target - decoded < 2 ** max(0, target.bit_length() - 15)


def test_difficulty_is_relative_to_the_difficulty_one_target() -> None:
    assert difficulty_for_target(MAX_TARGET) == 1.0
    assert difficulty_for_target(MAX_TARGET // 1_000) == pytest.approx(1_000, rel=1e-9)


def test_zero_bit_targets() -> None:
    assert target_for_zero_bits(0) == 2**256
    assert target_for_zero_bits(20) == 2**236
    for bad in (-1, 256):
        with pytest.raises(ValueError, match="between"):
            target_for_zero_bits(bad)


# --- Worker -------------------------------------------------------------------------------


def test_worker_finds_the_real_genesis_nonce() -> None:
    prefix = GENESIS_BLOCK.prefix()
    target = bits_to_target(GENESIS_BLOCK.bits) + 1  # "<= target" expressed as "< target + 1"
    result = search_nonces(prefix, GENESIS_BLOCK.nonce - 10, 20, target, 5.0)
    assert result.found_nonce == GENESIS_BLOCK.nonce
    assert result.attempts == 11
    assert result.best_value == _full_hash_value(prefix, GENESIS_BLOCK.nonce)


def test_midstate_search_matches_full_double_hashing() -> None:
    prefix = BLOCK_1.prefix()
    result = search_nonces(prefix, 1_000, 3_000, 0, 10.0)
    expected = min(range(1_000, 4_000), key=lambda nonce: _full_hash_value(prefix, nonce))
    assert result.attempts == 3_000
    assert result.found_nonce is None
    assert result.best_nonce == expected
    assert result.best_value == _full_hash_value(prefix, expected)


def test_worker_stops_at_the_first_valid_hash() -> None:
    prefix = GENESIS_BLOCK.prefix()
    target = target_for_zero_bits(8)
    result = search_nonces(prefix, 0, 100_000, target, 10.0)
    assert result.found_nonce is not None
    found = _full_hash_value(prefix, result.found_nonce)
    assert found < target
    # No earlier nonce was valid.
    assert all(_full_hash_value(prefix, nonce) >= target for nonce in range(result.found_nonce))


def test_worker_respects_its_time_budget() -> None:
    result = search_nonces(GENESIS_BLOCK.prefix(), 0, 50_000_000, 0, 0.05)
    assert result.elapsed < 0.5
    assert 0 < result.attempts < 50_000_000


def test_worker_edge_cases() -> None:
    assert search_nonces(GENESIS_BLOCK.prefix(), 5, 0, 0, 1.0).attempts == 0
    with pytest.raises(ValueError, match="76-byte"):
        search_nonces(b"short", 0, 1, 0, 1.0)


def test_lower_priority_uses_nice_when_available(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []
    monkeypatch.setattr(worker.os, "nice", calls.append, raising=False)
    worker.lower_priority()
    assert calls == [10]


# --- Competition ----------------------------------------------------------------------------

MINERS = [MinerSpec("Alpha", 600.0), MinerSpec("Beta", 300.0), MinerSpec("Gamma", 100.0)]


def test_competition_is_reproducible_with_a_seed() -> None:
    first = simulate_competition(MINERS, 20, 50, seed=42)
    second = simulate_competition(MINERS, 20, 50, seed=42)
    assert first == second
    assert simulate_competition(MINERS, 20, 50, seed=43) != first


def test_competition_statistics_match_theory() -> None:
    blocks = 2_000
    outcome = simulate_competition(MINERS, 20, blocks, seed=1)
    assert sum(miner.blocks_won for miner in outcome.miners) == blocks
    assert sum(miner.expected_share for miner in outcome.miners) == pytest.approx(1.0)
    assert outcome.expected_block_time_seconds == pytest.approx(2**20 / 1_000)
    for miner in outcome.miners:
        # Binomial: within 5 standard deviations of the expected count.
        sd = math.sqrt(blocks * miner.expected_share * (1 - miner.expected_share))
        assert abs(miner.blocks_won - miner.expected_blocks) < 5 * sd
    # Exponential inter-block times: the mean converges to the expectation.
    relative_sd = 1 / math.sqrt(blocks)
    assert outcome.mean_block_time_seconds == pytest.approx(
        outcome.expected_block_time_seconds, rel=5 * relative_sd
    )
    heights = [block.height for block in outcome.blocks]
    assert heights == list(range(1, blocks + 1))
    times = [block.time_seconds for block in outcome.blocks]
    assert times == sorted(times)


@pytest.mark.parametrize(
    ("miners", "blocks", "message"),
    [
        ([MinerSpec("Solo", 1.0)], 10, "two miners"),
        ([MinerSpec("A", 1.0), MinerSpec("B", 0.0)], 10, "positive"),
        (MINERS, 0, "at least one block"),
    ],
)
def test_competition_validation(miners: list[MinerSpec], blocks: int, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        simulate_competition(miners, 10, blocks, seed=0)
