import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { apiLatency } from "@/lib/apiLatency";

// jsdom has no layout engine or ResizeObserver; Recharts' ResponsiveContainer
// needs the latter and falls back to its `initialDimension` for size.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

afterEach(() => {
  cleanup();
  apiLatency.reset();
});
