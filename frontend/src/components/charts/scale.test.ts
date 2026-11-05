import { describe, expect, it } from "vitest";

import { formatMsTick, niceTicks } from "./scale";

describe("niceTicks", () => {
  it.each([
    [36, [0, 10, 20, 30, 40]],
    [120, [0, 50, 100, 150]],
    [2.3, [0, 1, 2, 3]],
    [9, [0, 2.5, 5, 7.5, 10]],
    [40, [0, 10, 20, 30, 40]],
    [0.07, [0, 0.02, 0.04, 0.06, 0.08]],
  ])("max %s -> %j", (max, expected) => {
    expect(niceTicks(max)).toEqual(expected);
  });

  it("handles empty or invalid ranges", () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(Number.NaN)).toEqual([0, 1]);
  });

  it("always covers the peak", () => {
    for (const max of [1, 3.7, 12, 99, 101, 999, 1234, 87_654]) {
      const ticks = niceTicks(max);
      expect(ticks.at(-1)).toBeGreaterThanOrEqual(max);
      expect(ticks[0]).toBe(0);
    }
  });
});

describe("formatMsTick", () => {
  it.each([
    [0, "0 ms"],
    [2.5, "2.5 ms"],
    [40, "40 ms"],
    [1_500, "1.5 s"],
    [2_000, "2 s"],
  ])("%s -> %s", (input, expected) => {
    expect(formatMsTick(input)).toBe(expected);
  });
});
