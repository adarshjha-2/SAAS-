import "@testing-library/jest-dom/vitest";

import { cleanup, configure } from "@testing-library/react";
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

// Routes are code-split: the first render of a page compiles its chunk on demand,
// which can exceed the default 1 s wait on a cold or busy machine.
configure({ asyncUtilTimeout: 5_000 });

afterEach(() => {
  cleanup();
  apiLatency.reset();
});
