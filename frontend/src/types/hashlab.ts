/** HashLab API contract (mirrors backend/nexus_hash/modules/hashlab/schemas.py). */

export interface HeaderInput {
  version: number;
  prev_block_hash: string;
  merkle_root: string;
  timestamp: number;
  bits: number;
  nonce: number;
}

export interface HashResponse {
  simulated: true;
  input_bytes: number;
  sha256: string;
  double_sha256: string;
  avalanche: { flipped_bit: number; sha256: string; changed_bits: number; changed_percent: number } | null;
}

export interface HeaderAnalysis {
  simulated: true;
  serialized_hex: string;
  fields: { name: keyof HeaderInput; offset: number; size: number; bytes_hex: string }[];
  hash: string;
  leading_zero_bits: number;
  target: string;
  difficulty: number;
  meets_target: boolean;
}

export interface HeaderPreset {
  key: string;
  name: string;
  description: string;
  header: HeaderInput;
  block_hash: string;
}

export interface NonceTry {
  nonce: number;
  hash: string;
  leading_zero_bits: number;
  meets_difficulty: boolean;
}

export interface NonceResponse {
  simulated: true;
  difficulty_bits: number;
  tries: NonceTry[];
  best: NonceTry;
}

export type JobKind = "mine" | "benchmark";
export type JobStatus =
  "queued" | "running" | "succeeded" | "exhausted" | "timed_out" | "cancelled" | "failed";

export interface JobView {
  simulated: true;
  id: string;
  kind: JobKind;
  status: JobStatus;
  difficulty_bits: number;
  expected_attempts: number;
  max_seconds: number;
  consent: boolean;
  attempts: number;
  elapsed_seconds: number;
  hash_rate_hs: number | null;
  best_hash: string | null;
  best_zero_bits: number | null;
  found_nonce: number | null;
  found_hash: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface JobRequest {
  kind: JobKind;
  difficulty_bits: number;
  max_seconds: number;
  consent: boolean;
  header?: HeaderInput;
  start_nonce?: number;
}

export interface HashLabLimits {
  max_difficulty_bits: number;
  max_job_seconds: number;
  consent_threshold_seconds: number;
  nonce_space: number;
  worker_processes: number;
}

export interface CompetitionMiner {
  name: string;
  hashrate_hs: number;
  expected_share: number;
  expected_blocks: number;
  blocks_won: number;
  actual_share: number;
}

export interface CompetitionRequest {
  miners: { name: string; hashrate_hs: number }[];
  difficulty_bits: number;
  blocks: number;
  seed: number | null;
}

export interface CompetitionResponse {
  simulated: true;
  difficulty_bits: number;
  expected_hashes_per_block: number;
  expected_block_time_seconds: number;
  mean_block_time_seconds: number;
  total_time_seconds: number;
  seed: number;
  miners: CompetitionMiner[];
  blocks: { height: number; winner: string; interval_seconds: number; time_seconds: number }[];
}

export const JOB_FINISHED: ReadonlySet<JobStatus> = new Set([
  "succeeded",
  "exhausted",
  "timed_out",
  "cancelled",
  "failed",
]);
