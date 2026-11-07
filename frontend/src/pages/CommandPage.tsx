import { Link } from "react-router";

import { ActivityFeed } from "@/components/activity/ActivityFeed";
import { Panel } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { useHealth, useSystemInfo } from "@/hooks/useSystem";

import { BackendOffline } from "./command/BackendOffline";
import { ModuleSlots } from "./command/ModuleSlots";
import { PlatformPolicy } from "./command/PlatformPolicy";
import { StatusTiles } from "./command/StatusTiles";
import { TelemetryPanel } from "./command/TelemetryPanel";

/** Nexus Command: the central dashboard composed from every module's live state. */
export function CommandPage() {
  const health = useHealth();
  const info = useSystemInfo();

  return (
    <div className="space-y-6">
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

      {health.isError && <BackendOffline error={health.error} />}

      <StatusTiles />

      <div className="grid gap-6 xl:grid-cols-12">
        <div className="xl:col-span-8">
          <TelemetryPanel />
        </div>
        <Panel
          title="Activity log"
          eyebrow="Events"
          actions={<ProvenanceBadge kind="live" />}
          className="xl:col-span-4"
        >
          <div className="max-h-[330px] overflow-y-auto pr-1">
            <ActivityFeed />
          </div>
          <Link to="/activity" className="mt-4 inline-block text-sm text-flux-400 hover:text-flux-300">
            View full activity log →
          </Link>
        </Panel>
      </div>

      <ModuleSlots />

      <PlatformPolicy />
    </div>
  );
}
