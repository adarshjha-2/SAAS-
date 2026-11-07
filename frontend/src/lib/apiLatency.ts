import { useSyncExternalStore } from "react";

import { SampleStore, type Sample } from "./telemetry";

/**
 * Round-trip time of backend health checks as observed by this tab
 * (request start to parsed response). Only successful requests are recorded.
 */
export const apiLatency = new SampleStore();

export function useApiLatency(): readonly Sample[] {
  return useSyncExternalStore(apiLatency.subscribe, apiLatency.getSnapshot);
}
