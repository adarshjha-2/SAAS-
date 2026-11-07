import type { ServerActivityEntry } from "@/types/api";

export type ActivityLevel = "info" | "success" | "warning" | "error";

/**
 * Where an entry came from. `session` entries are observed by this browser
 * tab (connection changes, health transitions) and live only in memory;
 * `server` entries come from the backend's persisted activity log.
 */
export type ActivitySource = "session" | "server";

export interface ActivityEntry {
  /** Unique across sources: `session-3`, `server-42`. */
  key: string;
  ts: number;
  level: ActivityLevel;
  source: ActivitySource;
  message: string;
  detail?: string;
  /** Server entries only: subsystem and initiator. */
  category?: string;
  actor?: string;
  serverId?: number;
}

export type NewActivity = Pick<ActivityEntry, "level" | "message" | "detail">;

const MAX_ENTRIES = 100;
const DUPLICATE_WINDOW_MS = 2_000;

export function fromServerEntry(entry: ServerActivityEntry): ActivityEntry {
  return {
    key: `server-${entry.id}`,
    serverId: entry.id,
    ts: Date.parse(entry.ts),
    level: entry.level,
    source: "server",
    message: entry.message,
    ...(entry.detail ? { detail: entry.detail } : {}),
    category: entry.category,
    actor: entry.actor,
  };
}

/** Newest first; ties broken so the order is stable. */
function compareNewestFirst(a: ActivityEntry, b: ActivityEntry): number {
  if (b.ts !== a.ts) return b.ts - a.ts;
  if (a.serverId !== undefined && b.serverId !== undefined) return b.serverId - a.serverId;
  return a.key < b.key ? 1 : -1;
}

/** A bounded, observable activity log merging session and server entries, newest first. */
export class ActivityLog {
  private entries: ActivityEntry[] = [];
  private readonly serverKeys = new Set<string>();
  private nextSessionId = 1;
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): readonly ActivityEntry[] => this.entries;

  /** Record something this tab observed. */
  add(entry: NewActivity, ts: number = Date.now()): void {
    // Collapse an identical session message repeated within a short window (e.g. remounts).
    const previous = this.entries.find((existing) => existing.source === "session");
    if (previous && previous.message === entry.message && ts - previous.ts < DUPLICATE_WINDOW_MS) return;

    const key = `session-${this.nextSessionId}`;
    this.nextSessionId += 1;
    this.commit([...this.entries, { ...entry, key, ts, source: "session" }]);
  }

  /** Merge persisted entries (from the API or the live stream); duplicates are ignored. */
  ingestServer(entries: readonly ServerActivityEntry[]): void {
    const fresh = entries.map(fromServerEntry).filter((entry) => !this.serverKeys.has(entry.key));
    if (fresh.length === 0) return;
    this.commit([...this.entries, ...fresh]);
  }

  private commit(next: ActivityEntry[]): void {
    this.entries = next.sort(compareNewestFirst).slice(0, MAX_ENTRIES);
    this.serverKeys.clear();
    for (const entry of this.entries) if (entry.source === "server") this.serverKeys.add(entry.key);
    this.listeners.forEach((listener) => listener());
  }
}
