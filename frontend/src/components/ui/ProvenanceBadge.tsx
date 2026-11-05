import { cn } from "@/lib/format";

/**
 * Where a number comes from. Every figure on the dashboard carries one of
 * these so simulated, estimated, stale or unavailable data is never mistaken
 * for live measurement. Each badge is a text label, never colour alone.
 */
export type Provenance = "live" | "session" | "simulated" | "estimate" | "stale" | "offline" | "planned";

const BADGES: Record<Provenance, { label: string; className: string; title: string }> = {
  live: {
    label: "Live",
    className: "border-flux-500/30 text-flux-400",
    title: "Measured in real time",
  },
  session: {
    label: "This session",
    className: "border-edge-strong text-ink-muted",
    title: "Observed by this browser tab since it was opened",
  },
  simulated: {
    label: "Simulated",
    className: "border-series-3/40 text-ink",
    title: "Produced by the HashLab simulator, not the Bitcoin network",
  },
  estimate: {
    label: "Estimate",
    className: "border-ember-500/30 text-ember-300",
    title: "Modelled from stated assumptions; not a guarantee",
  },
  stale: {
    label: "Stale",
    className: "border-warn/40 text-warn",
    title: "The source stopped updating; showing the last known value",
  },
  offline: {
    label: "Offline",
    className: "border-fault/40 text-fault",
    title: "The source is unreachable",
  },
  planned: {
    label: "Planned",
    className: "border-edge-strong text-ink-faint",
    title: "Not implemented yet",
  },
};

export function ProvenanceBadge({ kind, suffix }: { kind: Provenance; suffix?: string }) {
  const badge = BADGES[kind];
  return (
    <span
      title={badge.title}
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] tracking-wider whitespace-nowrap uppercase",
        badge.className,
      )}
    >
      {badge.label}
      {suffix && <span className="ml-1 opacity-70">· {suffix}</span>}
    </span>
  );
}
