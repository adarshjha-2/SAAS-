import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { apiGet } from "@/lib/api";
import { useRealtimeConnection } from "@/lib/realtimeContext";
import type { HardwareHistory, HardwareSample, HardwareSpecs, LiveSamples } from "@/types/hardware";

const BASE = "/api/v1/hardware";
const MAX_LIVE_SAMPLES = 300; // 10 minutes at the default 2 s interval

export const hardwareKeys = {
  specs: ["hardware", "specs"] as const,
  live: ["hardware", "live"] as const,
  history: (hours: number) => ["hardware", "history", hours] as const,
};

export function useHardwareSpecs() {
  return useQuery({
    queryKey: hardwareKeys.specs,
    queryFn: ({ signal }) => apiGet<HardwareSpecs>(`${BASE}/specs`, { signal }),
    staleTime: 5 * 60_000,
  });
}

export function useHardwareHistory(hours: number) {
  return useQuery({
    queryKey: hardwareKeys.history(hours),
    queryFn: ({ signal }) => apiGet<HardwareHistory>(`${BASE}/history?hours=${hours}`, { signal }),
    refetchInterval: 60_000, // a new aggregate row lands every minute
  });
}

/**
 * The last 10 minutes of samples: loaded once from the API, then extended by
 * every `hardware` event (each sample is delivered, even in bursts).
 */
export function useHardwareStream(): { samples: HardwareSample[]; isError: boolean; isPending: boolean } {
  const connection = useRealtimeConnection();
  const initial = useQuery({
    queryKey: hardwareKeys.live,
    queryFn: ({ signal }) => apiGet<LiveSamples>(`${BASE}/live`, { signal }),
    staleTime: Infinity,
  });
  const [streamed, setStreamed] = useState<HardwareSample[]>([]);

  useEffect(
    () =>
      connection.onEvent("hardware", (event) => {
        const sample = (event.data as { sample: HardwareSample | null }).sample;
        if (sample) setStreamed((current) => [...current, sample].slice(-MAX_LIVE_SAMPLES));
      }),
    [connection],
  );

  // Merge without duplicates: the snapshot replayed on subscribe may also be in the API page.
  const seen = new Set<string>();
  const samples = [...(initial.data?.samples ?? []), ...streamed]
    .filter((sample) => (seen.has(sample.ts) ? false : (seen.add(sample.ts), true)))
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
    .slice(-MAX_LIVE_SAMPLES);
  return { samples, isError: initial.isError, isPending: initial.isPending };
}
