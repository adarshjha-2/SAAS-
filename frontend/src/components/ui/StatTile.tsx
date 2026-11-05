import type { ReactNode } from "react";

import { cn } from "@/lib/format";

import { Sparkline } from "./Sparkline";
import type { Tone } from "./status-meta";

const VALUE_TONE: Partial<Record<Tone, string>> = {
  ember: "text-ember-400",
  flux: "text-flux-400",
  fault: "text-fault",
  warn: "text-warn",
  ok: "text-ok",
};

interface StatTileProps {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: Tone;
  /** Recent values for a trend sparkline (oldest first). */
  trend?: readonly number[];
  trendColor?: string;
  trendLabel?: string;
}

/**
 * A single headline metric. Values use the monospace face so live-updating
 * numbers (uptime, latency) don't jitter as digits change.
 */
export function StatTile({
  icon,
  label,
  value,
  detail,
  tone = "idle",
  trend,
  trendColor,
  trendLabel,
}: StatTileProps) {
  return (
    <div className="flex animate-fade-up flex-col rounded-xl border border-edge bg-panel/80 p-4">
      <div className="flex items-center gap-2 text-ink-faint">
        {icon}
        <p className="font-mono text-[10px] tracking-[0.2em] uppercase">{label}</p>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <p className={cn("font-mono text-xl font-semibold", VALUE_TONE[tone] ?? "text-ink")}>{value}</p>
        {trend && trend.length >= 2 && (
          <Sparkline
            values={trend}
            color={trendColor ?? "var(--color-series-1)"}
            label={trendLabel ?? `${label} trend`}
          />
        )}
      </div>
      {detail && <p className="mt-1 text-xs text-ink-muted">{detail}</p>}
    </div>
  );
}
