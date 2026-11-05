import { Menu } from "lucide-react";
import { useLocation } from "react-router";

import { StatusPill } from "@/components/ui/Status";
import type { Tone } from "@/components/ui/status-meta";
import { NAV_ITEMS, PAGE_TITLES } from "@/config/navigation";
import { useHealth } from "@/hooks/useSystem";
import type { ConnectionStatus } from "@/lib/realtime";
import { useRealtime } from "@/lib/realtimeContext";

const REALTIME_META: Record<ConnectionStatus, { tone: Tone; label: string }> = {
  idle: { tone: "idle", label: "Stream idle" },
  connecting: { tone: "warn", label: "Stream connecting" },
  open: { tone: "flux", label: "Stream live" },
  reconnecting: { tone: "warn", label: "Stream reconnecting" },
  closed: { tone: "idle", label: "Stream closed" },
};

function useApiStatus(): { tone: Tone; label: string; title: string } {
  const health = useHealth();
  if (health.isPending) return { tone: "warn", label: "API checking", title: "Contacting backend…" };
  if (health.isError) return { tone: "fault", label: "API offline", title: health.error.message };
  if (health.data.status === "ok") {
    return { tone: "ok", label: "API online", title: `Backend v${health.data.version}` };
  }
  return { tone: "warn", label: "API degraded", title: JSON.stringify(health.data.checks) };
}

export function TopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { pathname } = useLocation();
  const realtime = useRealtime();
  const api = useApiStatus();
  const stream = REALTIME_META[realtime.status];
  const current = NAV_ITEMS.find((item) => item.path === pathname);

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-edge/70 bg-void/80 px-4 backdrop-blur-md sm:px-6">
      <button
        type="button"
        onClick={onOpenMenu}
        className="rounded-lg p-2 text-ink-muted hover:bg-panel-raised hover:text-ink lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[10px] tracking-[0.22em] text-ink-faint uppercase">NEXUS HASH AI</p>
        <p className="truncate font-display text-sm font-semibold tracking-wide">
          {current?.label ?? PAGE_TITLES[pathname] ?? "Unknown route"}
        </p>
      </div>
      <div className="flex items-center gap-2" aria-live="polite">
        <StatusPill tone={api.tone} label={api.label} title={api.title} pulse={api.tone === "warn"} />
        <span className="hidden sm:inline-flex">
          <StatusPill tone={stream.tone} label={stream.label} pulse={realtime.status === "open"} />
        </span>
      </div>
    </header>
  );
}
