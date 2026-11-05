import { CircleCheck, CircleX, Info, TriangleAlert, type LucideIcon } from "lucide-react";

import type { ActivityEntry, ActivityLevel } from "@/lib/activity";
import { useActivityEntries } from "@/lib/activityContext";
import { cn, formatClock } from "@/lib/format";

const LEVELS: Record<ActivityLevel, { icon: LucideIcon; label: string; className: string }> = {
  info: { icon: Info, label: "Info", className: "text-ink-muted" },
  success: { icon: CircleCheck, label: "Resolved", className: "text-ok" },
  warning: { icon: TriangleAlert, label: "Warning", className: "text-warn" },
  error: { icon: CircleX, label: "Error", className: "text-fault" },
};

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const level = LEVELS[entry.level];
  const Icon = level.icon;
  return (
    <li className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
      <Icon className={cn("mt-0.5 size-4 shrink-0", level.className)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink">
          <span className="sr-only">{level.label}: </span>
          {entry.message}
        </p>
        {entry.detail && (
          <p title={entry.detail} className="truncate text-xs text-ink-faint">
            {entry.detail}
          </p>
        )}
      </div>
      <time
        dateTime={new Date(entry.ts).toISOString()}
        className="shrink-0 font-mono text-[11px] text-ink-faint"
      >
        {formatClock(entry.ts)}
      </time>
    </li>
  );
}

/** Newest-first activity for this session; server-side history joins in Milestone 3. */
export function ActivityFeed({ limit = 12 }: { limit?: number }) {
  const entries = useActivityEntries();
  if (entries.length === 0) {
    return <p className="text-sm text-ink-faint">No activity recorded yet.</p>;
  }
  return (
    <ol aria-label="Activity log" className="divide-y divide-edge/70">
      {entries.slice(0, limit).map((entry) => (
        <ActivityRow key={entry.id} entry={entry} />
      ))}
    </ol>
  );
}
