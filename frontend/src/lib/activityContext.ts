import { createContext, use, useSyncExternalStore } from "react";

import type { ActivityEntry, ActivityLog } from "./activity";

export const ActivityContext = createContext<ActivityLog | null>(null);

export function useActivityLog(): ActivityLog {
  const log = use(ActivityContext);
  if (!log) throw new Error("useActivityLog must be used inside <AppProviders>");
  return log;
}

export function useActivityEntries(): readonly ActivityEntry[] {
  const log = useActivityLog();
  return useSyncExternalStore(log.subscribe, log.getSnapshot);
}
