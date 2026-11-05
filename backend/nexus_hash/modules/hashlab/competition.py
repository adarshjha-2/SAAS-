"""Simulated mining competition in simulated time (no hashing, negligible CPU).

Each miner finds blocks as an independent Poisson process with rate
hashrate / expected_hashes_per_block. The time to the next block is
exponential in the combined rate, and the winner is drawn with probability
proportional to hash rate - the same statistics as real mining, including
luck and variance.
"""

from __future__ import annotations

import random
from dataclasses import dataclass


@dataclass(frozen=True)
class MinerSpec:
    name: str
    hashrate_hs: float


@dataclass(frozen=True)
class BlockEvent:
    height: int
    winner: str
    interval_seconds: float
    time_seconds: float


@dataclass(frozen=True)
class MinerOutcome:
    name: str
    hashrate_hs: float
    expected_share: float
    expected_blocks: float
    blocks_won: int
    actual_share: float


@dataclass(frozen=True)
class CompetitionOutcome:
    difficulty_bits: int
    expected_hashes_per_block: float
    expected_block_time_seconds: float
    mean_block_time_seconds: float
    total_time_seconds: float
    blocks: list[BlockEvent]
    miners: list[MinerOutcome]
    seed: int


def simulate_competition(
    miners: list[MinerSpec], difficulty_bits: int, blocks: int, seed: int
) -> CompetitionOutcome:
    if len(miners) < 2:  # noqa: PLR2004 - a competition needs two miners
        raise ValueError("a competition needs at least two miners")
    if any(miner.hashrate_hs <= 0 for miner in miners):
        raise ValueError("hash rates must be positive")
    if blocks < 1:
        raise ValueError("simulate at least one block")

    rng = random.Random(seed)  # noqa: S311 - simulation, not cryptography
    work = float(2**difficulty_bits)  # expected hashes to find one block
    total_rate = sum(miner.hashrate_hs for miner in miners)
    weights = [miner.hashrate_hs for miner in miners]
    names = [miner.name for miner in miners]

    wins = dict.fromkeys(names, 0)
    events: list[BlockEvent] = []
    clock = 0.0
    for height in range(1, blocks + 1):
        interval = rng.expovariate(total_rate / work)
        clock += interval
        winner = rng.choices(names, weights=weights)[0]
        wins[winner] += 1
        events.append(BlockEvent(height, winner, interval, clock))

    outcomes = [
        MinerOutcome(
            name=miner.name,
            hashrate_hs=miner.hashrate_hs,
            expected_share=miner.hashrate_hs / total_rate,
            expected_blocks=blocks * miner.hashrate_hs / total_rate,
            blocks_won=wins[miner.name],
            actual_share=wins[miner.name] / blocks,
        )
        for miner in miners
    ]
    return CompetitionOutcome(
        difficulty_bits=difficulty_bits,
        expected_hashes_per_block=work,
        expected_block_time_seconds=work / total_rate,
        mean_block_time_seconds=clock / blocks,
        total_time_seconds=clock,
        blocks=events,
        miners=outcomes,
        seed=seed,
    )
