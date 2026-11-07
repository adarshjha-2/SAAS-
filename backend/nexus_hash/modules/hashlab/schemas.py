"""HashLab API contract. Every response carries `simulated: true`."""

from __future__ import annotations

import re
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator, model_validator

from .pow import UINT32_MAX, BlockHeader, bits_to_target

_HEX64 = re.compile(r"^[0-9a-fA-F]{64}$")
_HEX = re.compile(r"^(?:[0-9a-fA-F]{2})*$")

MAX_TEXT_CHARS = 1_000
MAX_HEX_CHARS = 2_000
MAX_NONCE_BATCH = 64


def _hash_hex(value: str) -> str:
    if not _HEX64.fullmatch(value):
        raise ValueError("must be 64 hexadecimal characters (a 256-bit hash)")
    return value.lower()


HashHex = Annotated[str, AfterValidator(_hash_hex)]
UInt32 = Annotated[int, Field(ge=0, le=UINT32_MAX)]


class Simulated(BaseModel):
    """Marker carried by every HashLab response."""

    simulated: Literal[True] = True


# --- SHA-256 playground ----------------------------------------------------------


class HashRequest(BaseModel):
    text: str | None = Field(default=None, max_length=MAX_TEXT_CHARS)
    hex: str | None = Field(default=None, max_length=MAX_HEX_CHARS)

    @field_validator("hex")
    @classmethod
    def _valid_hex(cls, value: str | None) -> str | None:
        if value is not None and not _HEX.fullmatch(value):
            raise ValueError("must be an even number of hexadecimal characters")
        return value

    @model_validator(mode="after")
    def _exactly_one(self) -> HashRequest:
        if (self.text is None) == (self.hex is None):
            raise ValueError("provide exactly one of `text` or `hex`")
        return self

    def payload(self) -> bytes:
        return self.text.encode() if self.text is not None else bytes.fromhex(self.hex or "")


class Avalanche(BaseModel):
    flipped_bit: int
    sha256: str
    changed_bits: int
    changed_percent: float


class HashResponse(Simulated):
    input_bytes: int
    sha256: str
    double_sha256: str
    avalanche: Avalanche | None


# --- Block header lab ------------------------------------------------------------


class HeaderInput(BaseModel):
    version: int = Field(ge=-(2**31), le=2**31 - 1)
    prev_block_hash: HashHex
    merkle_root: HashHex
    timestamp: UInt32
    bits: UInt32
    nonce: UInt32

    @field_validator("bits")
    @classmethod
    def _valid_compact_target(cls, value: int) -> int:
        bits_to_target(value)  # raises ValueError for malformed encodings
        return value

    def to_header(self) -> BlockHeader:
        return BlockHeader(**self.model_dump())

    @classmethod
    def from_header(cls, header: BlockHeader) -> HeaderInput:
        return cls(
            version=header.version,
            prev_block_hash=header.prev_block_hash,
            merkle_root=header.merkle_root,
            timestamp=header.timestamp,
            bits=header.bits,
            nonce=header.nonce,
        )


class HeaderField(BaseModel):
    name: str
    offset: int
    size: int
    bytes_hex: str


class HeaderAnalysis(Simulated):
    serialized_hex: str
    fields: list[HeaderField]
    hash: str
    leading_zero_bits: int
    target: str
    difficulty: float
    meets_target: bool


class HeaderPreset(BaseModel):
    key: str
    name: str
    description: str
    header: HeaderInput
    block_hash: str


# --- Nonce explorer ---------------------------------------------------------------


class NonceRequest(BaseModel):
    header: HeaderInput
    start_nonce: UInt32 = 0
    count: int = Field(default=16, ge=1, le=MAX_NONCE_BATCH)
    difficulty_bits: int = Field(default=8, ge=1, le=64)


class NonceTry(BaseModel):
    nonce: int
    hash: str
    leading_zero_bits: int
    meets_difficulty: bool


class NonceResponse(Simulated):
    difficulty_bits: int
    tries: list[NonceTry]
    best: NonceTry


# --- Mining jobs -------------------------------------------------------------------


class JobKind(StrEnum):
    MINE = "mine"
    BENCHMARK = "benchmark"


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"  # block found (mine) / measurement completed (benchmark)
    EXHAUSTED = "exhausted"  # the 2^32 nonce range ran out without a valid hash
    TIMED_OUT = "timed_out"
    CANCELLED = "cancelled"
    FAILED = "failed"

    @property
    def finished(self) -> bool:
        return self not in {JobStatus.QUEUED, JobStatus.RUNNING}


class JobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: JobKind = JobKind.MINE
    # Bounds here are the absolute ceiling; configured server limits apply on top.
    difficulty_bits: int = Field(default=20, ge=1, le=64)
    max_seconds: float = Field(default=2.0, gt=0, le=3_600)
    header: HeaderInput | None = None
    start_nonce: UInt32 = 0
    consent: bool = False


class JobView(Simulated):
    id: str
    kind: JobKind
    status: JobStatus
    difficulty_bits: int
    expected_attempts: float
    max_seconds: float
    consent: bool
    attempts: int
    elapsed_seconds: float
    hash_rate_hs: float | None
    best_hash: str | None
    best_zero_bits: int | None
    found_nonce: int | None
    found_hash: str | None
    error: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class HashLabLimits(BaseModel):
    max_difficulty_bits: int
    max_job_seconds: float
    consent_threshold_seconds: float
    nonce_space: int
    worker_processes: int


# --- Competition ---------------------------------------------------------------------


class CompetitionMinerInput(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    hashrate_hs: float = Field(gt=0, le=1e24)

    @field_validator("name")
    @classmethod
    def _strip(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("must not be blank")
        return stripped


class CompetitionRequest(BaseModel):
    miners: list[CompetitionMinerInput] = Field(min_length=2, max_length=8)
    difficulty_bits: int = Field(default=32, ge=1, le=128)
    blocks: int = Field(default=200, ge=1, le=2_000)
    seed: int | None = Field(default=None, ge=0, le=2**63 - 1)

    @field_validator("miners")
    @classmethod
    def _unique_names(cls, miners: list[CompetitionMinerInput]) -> list[CompetitionMinerInput]:
        names = [miner.name.casefold() for miner in miners]
        if len(set(names)) != len(names):
            raise ValueError("miner names must be unique")
        return miners


class CompetitionBlock(BaseModel):
    height: int
    winner: str
    interval_seconds: float
    time_seconds: float


class CompetitionMiner(BaseModel):
    name: str
    hashrate_hs: float
    expected_share: float
    expected_blocks: float
    blocks_won: int
    actual_share: float


class CompetitionResponse(Simulated):
    difficulty_bits: int
    expected_hashes_per_block: float
    expected_block_time_seconds: float
    mean_block_time_seconds: float
    total_time_seconds: float
    seed: int
    miners: list[CompetitionMiner]
    blocks: list[CompetitionBlock]
