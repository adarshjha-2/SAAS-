import { describe, expect, it } from "vitest";

import { cn, formatBytes, formatDuration } from "./format";

describe("formatDuration", () => {
  it.each([
    [0, "00:00:00"],
    [59.9, "00:00:59"],
    [3_725, "01:02:05"],
    [93_784, "1d 02:03:04"],
    [-5, "00:00:00"],
  ])("formats %s seconds as %s", (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [4_096, "4 KiB"],
    [1_536, "1.5 KiB"],
    [1_048_576, "1 MiB"],
    [50 * 1_048_576, "50 MiB"],
  ])("formats %s bytes as %s", (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });
});

describe("cn", () => {
  it("joins truthy class names", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });
});
