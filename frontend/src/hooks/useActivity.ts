import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { useActivityLog } from "@/lib/activityContext";
import { apiGet } from "@/lib/api";
import type { ConnectionStatus } from "@/lib/realtime";
import { useRealtime, useRealtimeConnection } from "@/lib/realtimeContext";
import type { ActivityCategoryName, ActivityLevelName, ActivityPage, ServerActivityEntry } from "@/types/api";

export const activityKeys = {
  all: ["activity"] as const,
  feed: ["activity", "feed"] as const,
  list: (filters: ActivityFilters) => ["activity", "list", filters] as const,
};

export interface ActivityFilters {
  level?: ActivityLevelName | undefined;
  category?: ActivityCategoryName | undefined;
}

const FEED_LIMIT = 50;
const PAGE_LIMIT = 50;

function activityPath(limit: number, filters: ActivityFilters = {}, beforeId?: number): string {
  const params = new URLSearchParams({ limit: String(limit) });
  if (beforeId !== undefined) params.set("before_id", String(beforeId));
  if (filters.level) params.set("level", filters.level);
  if (filters.category) params.set("category", filters.category);
  return `/api/v1/activity?${params.toString()}`;
}

/**
 * Keeps the shared activity log in sync with the server: loads the latest
 * page, merges live `activity` events as they arrive, and backfills after a
 * reconnect so nothing recorded during a disconnection is missed. Mount once.
 */
export function useServerActivitySync(): void {
  const log = useActivityLog();
  const connection = useRealtimeConnection();
  const queryClient = useQueryClient();
  const { status } = useRealtime();

  const feed = useQuery({
    queryKey: activityKeys.feed,
    queryFn: ({ signal }) => apiGet<ActivityPage>(activityPath(FEED_LIMIT), { signal }),
  });

  useEffect(() => {
    if (feed.data) log.ingestServer(feed.data.items);
  }, [feed.data, log]);

  useEffect(
    () =>
      connection.onEvent("activity", (event) => {
        log.ingestServer([event.data as unknown as ServerActivityEntry]);
        // Filtered lists on the activity page refresh to include the new entry.
        void queryClient.invalidateQueries({ queryKey: ["activity", "list"] });
      }),
    [connection, log, queryClient],
  );

  const previous = useRef<ConnectionStatus>(status);
  useEffect(() => {
    const wasDown = previous.current === "reconnecting";
    previous.current = status;
    if (status === "open" && wasDown) void queryClient.invalidateQueries({ queryKey: activityKeys.all });
  }, [status, queryClient]);
}

/** Paginated, filterable server activity for the full log page. */
export function useActivityPages(filters: ActivityFilters) {
  return useInfiniteQuery({
    queryKey: activityKeys.list(filters),
    queryFn: ({ pageParam, signal }) =>
      apiGet<ActivityPage>(activityPath(PAGE_LIMIT, filters, pageParam), { signal }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.next_before_id ?? undefined,
  });
}
