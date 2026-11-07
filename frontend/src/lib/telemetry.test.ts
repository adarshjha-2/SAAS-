import { describe, expect, it, vi } from "vitest";

import { appendSample, latest, resampleSeries, SampleStore } from "./telemetry";

describe("appendSample", () => {
  it("appends immutably and keeps only the most recent samples", () => {
    const original = [{ t: 1, value: 1 }];
    const next = appendSample(original, { t: 2, value: 2 }, 2);
    expect(original).toHaveLength(1);
    expect(appendSample(next, { t: 3, value: 3 }, 2)).toEqual([
      { t: 2, value: 2 },
      { t: 3, value: 3 },
    ]);
  });
});

describe("SampleStore", () => {
  it("records valid samples, notifies listeners and resets", () => {
    const store = new SampleStore(3);
    const listener = vi.fn();
    store.subscribe(listener);
    store.record(5, 100);
    store.record(Number.NaN, 200);
    store.record(-1, 300);
    expect(store.getSnapshot()).toEqual([{ t: 100, value: 5 }]);
    expect(listener).toHaveBeenCalledTimes(1);
    store.reset();
    expect(store.getSnapshot()).toEqual([]);
  });
});

describe("resampleSeries", () => {
  const opts = { bucketMs: 5_000, maxAgeMs: 12_000, windowMs: 60_000 };

  it("returns nothing without samples", () => {
    expect(resampleSeries({ a: [], b: [] }, opts)).toEqual([]);
  });

  it("aligns independently-timed series onto shared buckets", () => {
    const rows = resampleSeries(
      {
        ws: [
          { t: 1_000, value: 10 },
          { t: 6_000, value: 11 },
          { t: 11_000, value: 12 },
        ],
        api: [{ t: 3_000, value: 40 }],
      },
      opts,
    );
    expect(rows).toEqual([
      { t: 5_000, ws: 10, api: 40 },
      { t: 10_000, ws: 11, api: 40 },
      { t: 15_000, ws: 12, api: 40 },
    ]);
  });

  it("turns measurements older than maxAge into gaps instead of inventing values", () => {
    const rows = resampleSeries(
      {
        ws: [
          { t: 1_000, value: 10 },
          { t: 31_000, value: 30 },
        ],
      },
      opts,
    );
    const values = rows.map((row) => row.ws);
    expect(values[0]).toBe(10);
    expect(values).toContain(null);
    expect(values.at(-1)).toBe(30);
  });

  it("never reports a sample before it was taken", () => {
    const rows = resampleSeries({ ws: [{ t: 9_000, value: 7 }], api: [{ t: 1_000, value: 1 }] }, opts);
    expect(rows[0]).toEqual({ t: 5_000, ws: null, api: 1 });
    expect(rows[1]).toEqual({ t: 10_000, ws: 7, api: 1 });
  });

  it("limits history to the window ending at the newest sample", () => {
    const samples = Array.from({ length: 100 }, (_, i) => ({ t: i * 5_000, value: i }));
    const rows = resampleSeries({ ws: samples }, opts);
    expect(rows).toHaveLength(12);
    expect(rows.at(-1)).toEqual({ t: 495_000, ws: 99 });
  });

  it("latest returns the last sample", () => {
    expect(
      latest([
        { t: 1, value: 1 },
        { t: 2, value: 9 },
      ])?.value,
    ).toBe(9);
    expect(latest([])).toBeUndefined();
  });
});
