import { Boxes, Bot, Clock, Radio, Server } from "lucide-react";

import { StatTile } from "@/components/ui/StatTile";
import type { Tone } from "@/components/ui/status-meta";
import { useLiveUptime } from "@/hooks/useLiveUptime";
import { useHealth, useModules, useSystemInfo } from "@/hooks/useSystem";
import { formatDuration, formatMs } from "@/lib/format";
import { useRealtime } from "@/lib/realtimeContext";
import type { SystemHeartbeat } from "@/types/api";

/**
 * Headline platform metrics. Stale values are never presented as live:
 * React Query keeps the last good data after a failed refetch, and the stream
 * keeps its last event after a drop, so both are gated on current health.
 */
export function StatusTiles() {
  const health = useHealth();
  const info = useSystemInfo();
  const modules = useModules();
  const realtime = useRealtime();

  const backendDown = health.isError;
  const streamOpen = realtime.status === "open";
  const heartbeat = streamOpen ? realtime.events.system : undefined;
  const beat = heartbeat?.data as SystemHeartbeat | undefined;
  const healthy = backendDown ? undefined : health.data;
  const uptime = useLiveUptime(
    beat?.uptime_seconds ?? healthy?.uptime_seconds,
    heartbeat?.receivedAt ?? (healthy ? health.dataUpdatedAt : undefined),
  );

  let backendValue = "…";
  let backendDetail = "Contacting API";
  let backendTone: Tone = "idle";
  if (backendDown) {
    backendValue = "OFFLINE";
    backendDetail = health.data ? `Last seen v${health.data.version}` : "No response yet";
    backendTone = "fault";
  } else if (healthy) {
    backendValue = healthy.status.toUpperCase();
    backendDetail = `v${healthy.version} · ${healthy.environment}`;
    backendTone = healthy.status === "ok" ? "flux" : "warn";
  }

  let streamValue: string = realtime.status.toUpperCase();
  let streamDetail = "Awaiting heartbeat";
  if (streamOpen) {
    streamValue = realtime.latencyMs === null ? "LIVE" : formatMs(realtime.latencyMs);
    if (beat)
      streamDetail = `Round-trip · ${beat.connections} connection${beat.connections === 1 ? "" : "s"}`;
  } else if (realtime.reconnectAttempt > 0) {
    streamDetail = `Retrying (attempt ${realtime.reconnectAttempt})`;
  }

  const total = modules.data?.length ?? 0;
  const online = modules.data?.filter((module) => module.status === "online").length ?? 0;

  return (
    <section
      aria-label="Platform status"
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5"
    >
      <StatTile
        icon={<Server className="size-3.5" />}
        label="Backend"
        value={backendValue}
        detail={backendDetail}
        tone={backendTone}
      />
      <StatTile
        icon={<Clock className="size-3.5" />}
        label="Uptime"
        value={uptime === undefined ? "—" : formatDuration(uptime)}
        detail={
          heartbeat
            ? "Live from realtime heartbeat"
            : healthy
              ? "From health check"
              : "Unavailable while the backend is offline"
        }
      />
      <StatTile
        icon={<Radio className="size-3.5" />}
        label="Realtime link"
        value={streamValue}
        detail={streamDetail}
        tone={streamOpen ? "flux" : realtime.status === "reconnecting" ? "warn" : "idle"}
        {...(streamOpen ? { trend: realtime.rttSamples.map((sample) => sample.value) } : {})}
        trendColor="var(--color-series-1)"
        trendLabel="Realtime round-trip trend, last 12 samples"
      />
      <StatTile
        icon={<Boxes className="size-3.5" />}
        label="Modules online"
        value={modules.data ? `${online} / ${total}` : "…"}
        detail="Each comes online when its milestone ships"
      />
      <StatTile
        icon={<Bot className="size-3.5" />}
        label="NEXUS CORE LLM"
        value={info.data ? (info.data.features.llm_configured ? "CONFIGURED" : "OFFLINE MODE") : "…"}
        detail={
          info.data?.features.llm_configured
            ? "API key held server-side only"
            : "Set ANTHROPIC_API_KEY in the backend .env"
        }
        tone={info.data?.features.llm_configured ? "ember" : "idle"}
      />
    </section>
  );
}
