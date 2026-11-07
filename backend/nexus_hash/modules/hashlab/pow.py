"""Bitcoin proof-of-work primitives, implemented exactly as the protocol does.

Byte-order note: Bitcoin serialises the header's integer fields
little-endian and stores hashes in "internal" byte order. Explorers display
hashes byte-reversed. This module accepts and returns *display* hex for
hashes, and does the reversal at the serialisation boundary.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

HEADER_SIZE = 80
NONCE_SPACE = 2**32
UINT32_MAX = 2**32 - 1
HASH_BITS = 256
COMPACT_MANTISSA_BYTES = 3  # nBits: 1 exponent byte + 3 mantissa bytes

# Difficulty-1 target (compact 0x1d00ffff), the reference for "difficulty".
MAX_TARGET = 0x00000000FFFF0000000000000000000000000000000000000000000000000000


def sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def double_sha256(data: bytes) -> bytes:
    return hashlib.sha256(hashlib.sha256(data).digest()).digest()


def hash_to_int(digest: bytes) -> int:
    """Numeric value of a hash as Bitcoin compares it against the target."""
    return int.from_bytes(digest, "little")


def display_hex(digest: bytes) -> str:
    return digest[::-1].hex()


def leading_zero_bits(value: int) -> int:
    """Leading zero bits of a 256-bit hash value (as displayed)."""
    return HASH_BITS - value.bit_length()


def bits_to_target(bits: int) -> int:
    """Expand the compact 'nBits' encoding into a 256-bit target."""
    if not 0 <= bits <= UINT32_MAX:
        raise ValueError("bits must be a 32-bit unsigned integer")
    exponent = bits >> 24
    mantissa = bits & 0x007FFFFF
    if bits & 0x00800000:
        raise ValueError("negative targets are invalid")
    if mantissa == 0:
        raise ValueError("target mantissa must be non-zero")
    shift = 8 * (exponent - COMPACT_MANTISSA_BYTES)
    target = mantissa << shift if shift >= 0 else mantissa >> -shift
    if target == 0:
        raise ValueError("target is zero (Bitcoin rejects this encoding as invalid)")
    if target >= 2**HASH_BITS:
        raise ValueError("target overflows 256 bits")
    return target


def target_to_bits(target: int) -> int:
    """Encode a target in the compact 'nBits' form (inverse of bits_to_target)."""
    if not 0 < target < 2**256:
        raise ValueError("target must be between 1 and 2**256 - 1")
    size = (target.bit_length() + 7) // 8
    shift = 8 * (size - COMPACT_MANTISSA_BYTES)
    mantissa = target >> shift if shift >= 0 else target << -shift
    if mantissa & 0x00800000:  # keep the sign bit clear
        mantissa >>= 8
        size += 1
    return (size << 24) | mantissa


def difficulty_for_target(target: int) -> float:
    """Bitcoin difficulty: how many times harder than the difficulty-1 target."""
    return MAX_TARGET / target


def target_for_zero_bits(zero_bits: int) -> int:
    """Educational target: a hash passes when it has at least `zero_bits` leading zeros."""
    if not 0 <= zero_bits < HASH_BITS:
        raise ValueError("zero_bits must be between 0 and 255")
    return 1 << (HASH_BITS - zero_bits)


@dataclass(frozen=True)
class BlockHeader:
    version: int
    prev_block_hash: str  # display hex, 64 chars
    merkle_root: str  # display hex, 64 chars
    timestamp: int
    bits: int
    nonce: int

    def serialize(self) -> bytes:
        return self.prefix() + self.nonce.to_bytes(4, "little")

    def prefix(self) -> bytes:
        """The first 76 bytes: everything except the nonce."""
        return (
            self.version.to_bytes(4, "little", signed=True)
            + bytes.fromhex(self.prev_block_hash)[::-1]
            + bytes.fromhex(self.merkle_root)[::-1]
            + self.timestamp.to_bytes(4, "little")
            + self.bits.to_bytes(4, "little")
        )

    def hash(self) -> bytes:
        """Double SHA-256 of the serialised header (internal byte order)."""
        return double_sha256(self.serialize())


# (name, offset, size) of each field in the 80-byte header.
HEADER_LAYOUT: tuple[tuple[str, int, int], ...] = (
    ("version", 0, 4),
    ("prev_block_hash", 4, 32),
    ("merkle_root", 36, 32),
    ("timestamp", 68, 4),
    ("bits", 72, 4),
    ("nonce", 76, 4),
)

# Real headers from the Bitcoin blockchain, used as presets and test vectors.
GENESIS_BLOCK = BlockHeader(
    version=1,
    prev_block_hash="00" * 32,
    merkle_root="4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b",
    timestamp=1_231_006_505,
    bits=0x1D00FFFF,
    nonce=2_083_236_893,
)
GENESIS_HASH = "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f"

BLOCK_1 = BlockHeader(
    version=1,
    prev_block_hash=GENESIS_HASH,
    merkle_root="0e3e2357e806b6cdb1f70b54c3a3a17b6714ee1f0e68bebb44a74b1efd512098",
    timestamp=1_231_469_665,
    bits=0x1D00FFFF,
    nonce=2_573_394_689,
)
BLOCK_1_HASH = "00000000839a8e6886ab5951d76f411475428afc90947ee320161bbf18eb6048"
