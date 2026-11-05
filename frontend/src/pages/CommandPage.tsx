import { Activity, Bot, Boxes, Clock, Radio, Server, ShieldCheck, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { Panel } from "@/components/ui/Panel";
import { StatusPill } from "@/components/ui/Status";
import { MODULE_STATUS_META, type Tone } from "@/components/ui/status-meta";
import { NAV_ITEMS } from "@/config/navigation";
import { useLiveUptime } from "@/hooks/useLiveUptime";
import { useHealth, useModules, useSystemInfo } from "@/hooks/useSystem";
import { ApiError } from "@/lib/api";
import { formatBytes, formatDuration } from "@/lib/format";
import { useRealtime } from "@/lib/realtimeContext";
import type { SystemHeartbeat } from "@/types/api";

const TILE_ACCENT: Partial<Record<Tone, string>> = {
  ember: "text-ember-400",
  flux: "text-flux-400",
  fault: "text-fault",
  warn: "text-warn",
};

function StatTile({
  icon,
  label,
  value,
  detail,
  tone = "idle",
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: Tone;
}) {
  const accent = TILE_ACCENT[tone] ?? "text-ink";
  return (
    <div className="animate-fade-up rounded-xl border border-edge bg-panel/80 p-4">
      <div className="flex items-center gap-2 text-ink-faint">
        {icon}
        <p className="font-mono text-[10px] tracking-[0.2em] uppercase">{label}</p>
      </div>
      <p className={`mt-3 font-mono text-xl font-semibold font-tabular ${accent}`}>{value}</p>
      {detail && <p className="mt-1 text-xs text-ink-muted">{detail}</p>}
    </div>
  );
}

function BackendOffline({ error }: { error: Error }) {
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  return (
    <Panel className="border-fault/40">
      <div className="flex items-start gap-4">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-fault" />
        <div className="space-y-2 text-sm">
          <p className="font-display font-semibold text-ink">Backend unreachable</p>
          <p className="text-ink-muted">{error.message}</p>
          <p className="text-ink-muted">
            Start it with{" "}
            <code className="rounded bg-panel-raised px-1.5 py-0.5 font-mono text-flux-400">
              make backend
            </code>{" "}
            and this view reconnects automatically.
          </p>
          {requestId && <p className="font-mono text-xs text-ink-faint">request id: {requestId}</p>}
        </div>
      </div>
    </Panel>
  );
}

export function CommandPage() {
  const health = useHealth();
  const info = useSystemInfo();
  const modules = useModules();
  const realtime = useRealtime();

  // Never present stale values as live: React Query keeps the last good data
  // after a failed refetch, and the stream keeps its last event after a drop.
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

  let streamDetail = "Awaiting heartbeat";
  if (beat) {
    streamDetail = `${beat.connections} active connection${beat.connections === 1 ? "" : "s"}`;
  } else if (!streamOpen && realtime.reconnectAttempt > 0) {
    streamDetail = `Retrying (attempt ${realtime.reconnectAttempt})`;
  }

  return (
    <div className="space-y-8">
      <section className="animate-fade-up">
        <p className="font-mono text-[11px] tracking-[0.3em] text-ember-400 uppercase">Nexus Command</p>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">
          Command{" "}
          <span className="bg-linear-to-r from-ember-500 to-flux-500 bg-clip-text text-transparent">
            Center
          </span>
        </h1>
        <p className="mt-2 max-w-2xl text-ink-muted">
          {info.data?.tagline ?? "Intelligence Beyond Computational Limits."}
        </p>
      </section>

      <div className="rounded-lg border border-flux-500/25 bg-flux-900/30 px-4 py-3 text-sm text-flux-300">
        Milestone 1 platform foundation. Every value below is live from the backend. Analytics charts, AI
        recommendations and the activity log arrive with the Milestone 2 command dashboard.
      </div>

      {health.isError && <BackendOffline error={health.error} />}

      <section aria-label="Platform status" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
          label="Realtime stream"
          value={streamOpen ? "LIVE" : realtime.status.toUpperCase()}
          detail={streamDetail}
          tone={streamOpen ? "flux" : realtime.status === "reconnecting" ? "warn" : "idle"}
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

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel title="Module deployment" eyebrow="Roadmap" className="lg:col-span-3">
          {modules.isError && <p className="text-sm text-fault">Could not load the module catalog.</p>}
          <ul className="divide-y divide-edge/70">
            {modules.data?.map((module) => {
              const meta = MODULE_STATUS_META[module.status];
              const nav = NAV_ITEMS.find((item) => item.key === module.key);
              const Icon = nav?.icon ?? Boxes;
              return (
                <li key={module.key} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                  <Icon className="size-4 shrink-0 text-ink-faint" />
                  <div className="min-w-0 flex-1">
                    <Link to={nav?.path ?? "/"} className="text-sm font-medium hover:text-ember-400">
                      {module.name}
                    </Link>
                    <p className="truncate text-xs text-ink-faint">{module.summary}</p>
                  </div>
                  <span className="font-mono text-[11px] text-ink-faint">M{module.milestone}</span>
                  <StatusPill tone={meta.tone} label={meta.label} />
                </li>
              );
            })}
          </ul>
        </Panel>

        <div className="space-y-6 lg:col-span-2">
          <Panel title="Safety guarantees" eyebrow="Policy">
            <ul className="space-y-3">
              {(info.data?.disclaimers ?? []).map((line) => (
                <li key={line} className="flex gap-3 text-sm text-ink-muted">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Resource limits" eyebrow="Enforced server-side">
            <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm">
              {info.data && (
                <>
                  <dt className="text-ink-muted">Max request body</dt>
                  <dd className="font-mono font-tabular">
                    {formatBytes(info.data.limits.max_request_body_bytes)}
                  </dd>
                  <dt className="text-ink-muted">Max realtime connections</dt>
                  <dd className="font-mono font-tabular">{info.data.limits.ws_max_connections}</dd>
                  <dt className="text-ink-muted">Max realtime message</dt>
                  <dd className="font-mono font-tabular">
                    {formatBytes(info.data.limits.ws_max_message_bytes)}
                  </dd>
                  <dt className="text-ink-muted">Heartbeat interval</dt>
                  <dd className="font-mono font-tabular">{info.data.realtime.heartbeat_seconds}s</dd>
                </>
              )}
            </dl>
            <p className="mt-4 flex items-center gap-2 text-xs text-ink-faint">
              <Activity className="size-3.5" /> Server-enforced limits apply to every client.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
