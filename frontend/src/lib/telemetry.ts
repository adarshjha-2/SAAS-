/** A single measurement: wall-clock time (epoch ms) and a value. */
export interface Sample {
  t: number;
  value: number;
}

/** 10 minutes of history at one sample every 5 seconds. */
export const DEFAULT_MAX_SAMPLES = 120;

/** Append immutably, keeping at most `max` most-recent samples. */
export function appendSample(
  samples: readonly Sample[],
  sample: Sample,
  max = DEFAULT_MAX_SAMPLES,
): Sample[] {
  const next = samples.length >= max ? samples.slice(samples.length - max + 1) : samples.slice();
  next.push(sample);
  return next;
}

/**
 * A bounded, observable buffer of samples (framework-agnostic; React binds
 * through `useSyncExternalStore`).
 */
export class SampleStore {
  private samples: Sample[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly max: number;

  constructor(max = DEFAULT_MAX_SAMPLES) {
    this.max = max;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): readonly Sample[] => this.samples;

  record(value: number, t: number = Date.now()): void {
    if (!Number.isFinite(value) || value < 0) return;
    this.samples = appendSample(this.samples, { t, value }, this.max);
    this.listeners.forEach((listener) => listener());
  }

  reset(): void {
    this.samples = [];
    this.listeners.forEach((listener) => listener());
  }
}

export type SeriesRow = { t: number } & Record<string, number | null>;

export interface ResampleOptions {
  /** Width of each time bucket. */
  bucketMs: number;
  /** A bucket shows a series' latest sample no older than this; otherwise null (a real gap). */
  maxAgeMs: number;
  /** Maximum span of history to return, ending at the newest sample. */
  windowMs: number;
}

/**
 * Align independently-timed series onto shared time buckets.
 *
 * Each bucket reports, per series, the most recent measurement taken at or
 * before the bucket's end, provided it is at most `maxAgeMs` old. Missing or
 * stale data becomes `null` so charts draw a visible gap instead of
 * inventing values. The window ends at the newest sample, so the function is
 * pure (no dependency on the current time).
 */
export function resampleSeries(
  seriesSamples: Record<string, readonly Sample[]>,
  { bucketMs, maxAgeMs, windowMs }: ResampleOptions,
): SeriesRow[] {
  const keys = Object.keys(seriesSamples);
  let newest = -Infinity;
  let oldest = Infinity;
  for (const key of keys) {
    for (const sample of seriesSamples[key] ?? []) {
      newest = Math.max(newest, sample.t);
      oldest = Math.min(oldest, sample.t);
    }
  }
  if (!Number.isFinite(newest)) return [];

  const end = Math.ceil(newest / bucketMs) * bucketMs;
  const start = Math.max(Math.floor(oldest / bucketMs) * bucketMs, end - windowMs);
  const cursors = Object.fromEntries(keys.map((key) => [key, 0]));
  const rows: SeriesRow[] = [];

  for (let bucketEnd = start + bucketMs; bucketEnd <= end; bucketEnd += bucketMs) {
    const row: SeriesRow = { t: bucketEnd };
    for (const key of keys) {
      const samples = seriesSamples[key] ?? [];
      let index = cursors[key] ?? 0;
      // Advance to the last sample at or before this bucket's end.
      while (index + 1 < samples.length && (samples[index + 1]?.t ?? Infinity) <= bucketEnd) index += 1;
      cursors[key] = index;
      const candidate = samples[index];
      row[key] =
        candidate && candidate.t <= bucketEnd && bucketEnd - candidate.t <= maxAgeMs ? candidate.value : null;
    }
    rows.push(row);
  }
  return rows;
}

/** The latest value of a sample list, or undefined. */
export function latest(samples: readonly Sample[]): Sample | undefined {
  return samples[samples.length - 1];
}
