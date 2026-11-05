export type ActivityLevel = "info" | "success" | "warning" | "error";

/**
 * Where an entry came from. `session` entries are observed by this browser
 * tab (connection changes, health transitions); `server` entries arrive from
 * the backend's persisted activity log (Milestone 3).
 */
export type ActivitySource = "session" | "server";

export interface ActivityEntry {
  id: number;
  ts: number;
  level: ActivityLevel;
  source: ActivitySource;
  message: string;
  detail?: string;
}

export type NewActivity = Omit<ActivityEntry, "id" | "ts" | "source"> & {
  source?: ActivitySource;
};

const MAX_ENTRIES = 100;
const DUPLICATE_WINDOW_MS = 2_000;

/** A bounded, observable activity log, newest entry first. */
export class ActivityLog {
  private entries: ActivityEntry[] = [];
  private nextId = 1;
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): readonly ActivityEntry[] => this.entries;

  add(entry: NewActivity, ts: number = Date.now()): void {
    const previous = this.entries[0];
    // Collapse an identical message repeated within a short window (e.g. remounts).
    if (previous && previous.message === entry.message && ts - previous.ts < DUPLICATE_WINDOW_MS) return;

    const next: ActivityEntry = { source: "session", ...entry, id: this.nextId, ts };
    this.nextId += 1;
    this.entries = [next, ...this.entries].slice(0, MAX_ENTRIES);
    this.listeners.forEach((listener) => listener());
  }
}
