/** Hardware Intelligence API contract (mirrors backend/nexus_hash/modules/hardware/schemas.py). */

export type CapabilityKey =
  "cpu" | "cpu_frequency" | "load_average" | "memory" | "swap" | "temperature" | "gpu" | "power";

export interface Capability {
  key: CapabilityKey;
  label: string;
  supported: boolean;
  source: string | null;
  reason: string | null;
}

export interface HardwareSpecs {
  hostname: string;
  os: string;
  architecture: string;
  cpu_model: string | null;
  cpu_logical_cores: number | null;
  cpu_physical_cores: number | null;
  cpu_max_frequency_mhz: number | null;
  memory_total_bytes: number;
  memory_limit_bytes: number | null;
  swap_total_bytes: number;
  virtualized: boolean | null;
  boot_time: string;
  gpus: { index: number; name: string; memory_total_bytes: number | null }[];
  capabilities: Capability[];
}

export interface GpuReading {
  index: number;
  utilization_percent: number | null;
  memory_used_bytes: number | null;
  memory_total_bytes: number | null;
  temperature_c: number | null;
  power_w: number | null;
}

export interface HardwareSample {
  ts: string;
  cpu_percent: number;
  cpu_per_core: number[];
  cpu_frequency_mhz: number | null;
  load_average: [number, number, number] | null;
  memory: { total_bytes: number; used_bytes: number; available_bytes: number; percent: number };
  swap: { total_bytes: number; used_bytes: number; percent: number } | null;
  temperatures: { label: string; celsius: number }[] | null;
  gpus: GpuReading[] | null;
  power_w: number | null;
  process: { cpu_percent: number; rss_bytes: number };
}

export interface LiveSamples {
  interval_seconds: number;
  samples: HardwareSample[];
}

export interface HistoryPoint {
  ts: string;
  window_seconds: number;
  samples: number;
  cpu_avg: number;
  cpu_max: number;
  memory_percent_avg: number;
  load1_avg: number | null;
  temperature_max_c: number | null;
  power_avg_w: number | null;
  gpu_utilization_avg: number | null;
}

export interface HardwareHistory {
  hours: number;
  points: HistoryPoint[];
}
