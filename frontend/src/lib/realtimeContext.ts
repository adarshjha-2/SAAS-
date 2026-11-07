import { createContext, use, useSyncExternalStore } from "react";

import type { RealtimeConnection, RealtimeSnapshot } from "./realtime";

export const RealtimeContext = createContext<RealtimeConnection | null>(null);

/** The shared connection itself, for per-event subscriptions (`onEvent`). */
export function useRealtimeConnection(): RealtimeConnection {
  const connection = use(RealtimeContext);
  if (!connection) throw new Error("useRealtimeConnection must be used inside <RealtimeProvider>");
  return connection;
}

/** Subscribe a component to the shared realtime connection's snapshot. */
export function useRealtime(): RealtimeSnapshot {
  const connection = use(RealtimeContext);
  if (!connection) throw new Error("useRealtime must be used inside <RealtimeProvider>");
  return useSyncExternalStore(connection.subscribe, connection.getSnapshot);
}
