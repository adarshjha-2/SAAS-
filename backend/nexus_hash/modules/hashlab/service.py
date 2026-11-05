"""Instant HashLab demonstrations: cheap, synchronous, bounded by input size."""

from __future__ import annotations

import secrets

from .competition import MinerSpec, simulate_competition
from .pow import (
    BLOCK_1,
    BLOCK_1_HASH,
    GENESIS_BLOCK,
    GENESIS_HASH,
    HEADER_LAYOUT,
    BlockHeader,
    bits_to_target,
    difficulty_for_target,
    display_hex,
    double_sha256,
    hash_to_int,
    leading_zero_bits,
    sha256,
)
from .schemas import (
    Avalanche,
    CompetitionBlock,
    CompetitionMiner,
    CompetitionRequest,
    CompetitionResponse,
    HashResponse,
    HeaderAnalysis,
    HeaderField,
    HeaderInput,
    HeaderPreset,
    NonceRequest,
    NonceResponse,
    NonceTry,
)


def hash_payload(payload: bytes) -> HashResponse:
    """SHA-256 and double SHA-256 of the input, plus the avalanche effect of
    flipping its last bit: on average about half of the output bits change."""
    digest = sha256(payload)
    avalanche = None
    if payload:
        flipped = payload[:-1] + bytes([payload[-1] ^ 0x01])
        flipped_digest = sha256(flipped)
        changed = (int.from_bytes(digest) ^ int.from_bytes(flipped_digest)).bit_count()
        avalanche = Avalanche(
            flipped_bit=len(payload) * 8 - 1,
            sha256=flipped_digest.hex(),
            changed_bits=changed,
            changed_percent=round(changed / 256 * 100, 2),
        )
    return HashResponse(
        input_bytes=len(payload),
        sha256=digest.hex(),
        double_sha256=double_sha256(payload).hex(),
        avalanche=avalanche,
    )


def analyze_header(header: BlockHeader) -> HeaderAnalysis:
    serialized = header.serialize()
    digest = double_sha256(serialized)
    value = hash_to_int(digest)
    target = bits_to_target(header.bits)
    return HeaderAnalysis(
        serialized_hex=serialized.hex(),
        fields=[
            HeaderField(
                name=name,
                offset=offset,
                size=size,
                bytes_hex=serialized[offset : offset + size].hex(),
            )
            for name, offset, size in HEADER_LAYOUT
        ],
        hash=display_hex(digest),
        leading_zero_bits=leading_zero_bits(value),
        target=f"{target:064x}",
        difficulty=difficulty_for_target(target),
        meets_target=value <= target,
    )


def try_nonces(request: NonceRequest) -> NonceResponse:
    base = request.header.to_header()
    last = min(request.start_nonce + request.count, 2**32)
    tries: list[NonceTry] = []
    for nonce in range(request.start_nonce, last):
        digest = double_sha256(base.prefix() + nonce.to_bytes(4, "little"))
        zeros = leading_zero_bits(hash_to_int(digest))
        tries.append(
            NonceTry(
                nonce=nonce,
                hash=display_hex(digest),
                leading_zero_bits=zeros,
                meets_difficulty=zeros >= request.difficulty_bits,
            )
        )
    best = max(tries, key=lambda attempt: attempt.leading_zero_bits)
    return NonceResponse(difficulty_bits=request.difficulty_bits, tries=tries, best=best)


def run_competition(request: CompetitionRequest) -> CompetitionResponse:
    seed = request.seed if request.seed is not None else secrets.randbelow(2**63)
    outcome = simulate_competition(
        [MinerSpec(miner.name, miner.hashrate_hs) for miner in request.miners],
        request.difficulty_bits,
        request.blocks,
        seed,
    )
    return CompetitionResponse(
        difficulty_bits=outcome.difficulty_bits,
        expected_hashes_per_block=outcome.expected_hashes_per_block,
        expected_block_time_seconds=outcome.expected_block_time_seconds,
        mean_block_time_seconds=outcome.mean_block_time_seconds,
        total_time_seconds=outcome.total_time_seconds,
        seed=outcome.seed,
        miners=[CompetitionMiner(**vars(miner)) for miner in outcome.miners],
        blocks=[CompetitionBlock(**vars(block)) for block in outcome.blocks],
    )


PRESETS: tuple[HeaderPreset, ...] = (
    HeaderPreset(
        key="genesis",
        name="Genesis block (height 0)",
        description="The first Bitcoin block, mined on 3 January 2009.",
        header=HeaderInput.from_header(GENESIS_BLOCK),
        block_hash=GENESIS_HASH,
    ),
    HeaderPreset(
        key="block-1",
        name="Block 1",
        description="The first block mined after the genesis block, on 9 January 2009.",
        header=HeaderInput.from_header(BLOCK_1),
        block_hash=BLOCK_1_HASH,
    ),
)
