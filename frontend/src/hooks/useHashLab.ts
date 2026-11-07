import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { apiGet, apiRequest } from "@/lib/api";
import { useRealtime } from "@/lib/realtimeContext";
import {
  JOB_FINISHED,
  type CompetitionRequest,
  type CompetitionResponse,
  type HashLabLimits,
  type HashResponse,
  type HeaderAnalysis,
  type HeaderInput,
  type HeaderPreset,
  type JobRequest,
  type JobView,
  type NonceResponse,
} from "@/types/hashlab";

const BASE = "/api/v1/hashlab";

export const hashlabKeys = {
  limits: ["hashlab", "limits"] as const,
  presets: ["hashlab", "presets"] as const,
  jobs: ["hashlab", "jobs"] as const,
};

function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return apiRequest<T>(
    `${BASE}${path}`,
    { method: "POST", body: JSON.stringify(body) },
    signal ? { signal } : {},
  );
}

export function useHashLabLimits() {
  return useQuery({
    queryKey: hashlabKeys.limits,
    queryFn: ({ signal }) => apiGet<HashLabLimits>(`${BASE}/limits`, { signal }),
    staleTime: Infinity,
  });
}

export function usePresets() {
  return useQuery({
    queryKey: hashlabKeys.presets,
    queryFn: ({ signal }) => apiGet<HeaderPreset[]>(`${BASE}/presets`, { signal }),
    staleTime: Infinity,
  });
}

/** Live SHA-256 of a text input (pass the debounced value). */
export function useSha256(text: string) {
  return useQuery({
    queryKey: ["hashlab", "sha256", text],
    queryFn: ({ signal }) => post<HashResponse>("/sha256", { text }, signal),
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });
}

export function useHeaderAnalysis(header: HeaderInput | null) {
  return useQuery({
    queryKey: ["hashlab", "header", header],
    queryFn: ({ signal }) => post<HeaderAnalysis>("/header", header, signal),
    enabled: header !== null,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    retry: false,
  });
}

export function useNonceTries() {
  return useMutation({
    mutationFn: (body: {
      header: HeaderInput;
      start_nonce: number;
      count: number;
      difficulty_bits: number;
    }) => post<NonceResponse>("/nonces", body),
  });
}

export function useCompetition() {
  return useMutation({
    mutationFn: (body: CompetitionRequest) => post<CompetitionResponse>("/competition", body),
  });
}

export function useRecentJobs(limit = 8) {
  return useQuery({
    queryKey: [...hashlabKeys.jobs, limit],
    queryFn: ({ signal }) => apiGet<JobView[]>(`${BASE}/jobs?limit=${limit}`, { signal }),
  });
}

export function useStartJob() {
  return useMutation({ mutationFn: (body: JobRequest) => post<JobView>("/jobs", body) });
}

export function useCancelJob() {
  return useMutation({ mutationFn: (id: string) => post<JobView>(`/jobs/${id}/cancel`, {}) });
}

/**
 * The run currently streamed on the `hashlab` topic (null when idle), plus the
 * last run this tab saw finish. Refreshes the recent-runs list when a run ends.
 */
export function useLiveJob(): { active: JobView | null; lastFinished: JobView | null } {
  const queryClient = useQueryClient();
  const event = useRealtime().events.hashlab;
  const job = (event?.data as { job: JobView | null } | undefined)?.job ?? null;
  const active = job && !JOB_FINISHED.has(job.status) ? job : null;
  const lastFinished = job && JOB_FINISHED.has(job.status) ? job : null;

  const finishedId = useRef<string | null>(null);
  useEffect(() => {
    if (lastFinished && finishedId.current !== lastFinished.id) {
      finishedId.current = lastFinished.id;
      void queryClient.invalidateQueries({ queryKey: hashlabKeys.jobs });
    }
  }, [lastFinished, queryClient]);

  return { active, lastFinished };
}
