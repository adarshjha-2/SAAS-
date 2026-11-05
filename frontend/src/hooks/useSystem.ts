import { useQuery } from "@tanstack/react-query";

import { apiGet } from "@/lib/api";
import type { HealthResponse, ModuleDescriptor, SystemInfo } from "@/types/api";

export const systemKeys = {
  health: ["system", "health"] as const,
  info: ["system", "info"] as const,
  modules: ["system", "modules"] as const,
};

export function useHealth() {
  return useQuery({
    queryKey: systemKeys.health,
    queryFn: ({ signal }) => apiGet<HealthResponse>("/api/v1/system/health", { signal }),
    refetchInterval: 10_000,
  });
}

export function useSystemInfo() {
  return useQuery({
    queryKey: systemKeys.info,
    queryFn: ({ signal }) => apiGet<SystemInfo>("/api/v1/system/info", { signal }),
    staleTime: 60_000,
  });
}

export function useModules() {
  return useQuery({
    queryKey: systemKeys.modules,
    queryFn: ({ signal }) => apiGet<ModuleDescriptor[]>("/api/v1/system/modules", { signal }),
    staleTime: 5 * 60_000,
  });
}
