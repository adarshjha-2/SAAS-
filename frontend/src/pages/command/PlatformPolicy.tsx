import { Activity, Boxes, ShieldCheck } from "lucide-react";
import { Link } from "react-router";

import { Panel } from "@/components/ui/Panel";
import { StatusPill } from "@/components/ui/Status";
import { MODULE_STATUS_META } from "@/components/ui/status-meta";
import { NAV_ITEMS } from "@/config/navigation";
import { useModules, useSystemInfo } from "@/hooks/useSystem";
import { formatBytes } from "@/lib/format";

export function PlatformPolicy() {
  const info = useSystemInfo();
  const modules = useModules();

  return (
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
          {info.data && (
            <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm">
              <dt className="text-ink-muted">Max request body</dt>
              <dd className="font-mono font-tabular">
                {formatBytes(info.data.limits.max_request_body_bytes)}
              </dd>
              <dt className="text-ink-muted">Max realtime connections</dt>
              <dd className="font-mono font-tabular">{info.data.limits.ws_max_connections}</dd>
              <dt className="text-ink-muted">Max realtime message</dt>
              <dd className="font-mono font-tabular">{formatBytes(info.data.limits.ws_max_message_bytes)}</dd>
              <dt className="text-ink-muted">Heartbeat interval</dt>
              <dd className="font-mono font-tabular">{info.data.realtime.heartbeat_seconds}s</dd>
              <dt className="text-ink-muted">Activity retention</dt>
              <dd className="font-mono font-tabular">{info.data.database.activity_retention_days} days</dd>
            </dl>
          )}
          <p className="mt-4 flex items-center gap-2 text-xs text-ink-faint">
            <Activity className="size-3.5" /> Server-enforced limits apply to every client.
          </p>
        </Panel>
      </div>
    </div>
  );
}
