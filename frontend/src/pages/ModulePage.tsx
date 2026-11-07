import { ArrowLeft, Boxes } from "lucide-react";
import { Link } from "react-router";

import { Panel } from "@/components/ui/Panel";
import { StatusPill } from "@/components/ui/Status";
import { MODULE_STATUS_META } from "@/components/ui/status-meta";
import { NAV_ITEMS } from "@/config/navigation";
import { useModules } from "@/hooks/useSystem";
import type { ModuleKey } from "@/types/api";

/**
 * Landing view for a module that is not implemented yet. It shows only the
 * catalog entry from the backend; it never renders placeholder metrics.
 */
export function ModulePage({ moduleKey }: { moduleKey: ModuleKey }) {
  const { data: modules, isPending, isError } = useModules();
  const nav = NAV_ITEMS.find((item) => item.key === moduleKey);
  const module = modules?.find((entry) => entry.key === moduleKey);
  const Icon = nav?.icon ?? Boxes;

  return (
    <div className="space-y-6">
      <Link to="/" className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Command Center
      </Link>

      <section className="flex animate-fade-up items-start gap-4">
        <div className="rounded-xl border border-ember-500/30 bg-ember-500/10 p-3 shadow-glow-ember">
          <Icon className="size-6 text-ember-400" />
        </div>
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">{module?.name ?? nav?.label}</h1>
          {module && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <StatusPill {...MODULE_STATUS_META[module.status]} />
              <span className="font-mono text-xs text-ink-faint">Milestone {module.milestone}</span>
            </div>
          )}
        </div>
      </section>

      {isPending && <p className="text-sm text-ink-muted">Loading module details…</p>}
      {isError && <p className="text-sm text-fault">Could not load module details from the backend.</p>}

      {module && (
        <Panel title="Scope" eyebrow="Module charter">
          <p className="max-w-3xl leading-relaxed text-ink-muted">{module.summary}</p>
          {module.status !== "online" && (
            <p className="mt-5 rounded-lg border border-edge bg-panel-raised px-4 py-3 text-sm text-ink-muted">
              This module is scheduled for <span className="text-ink">Milestone {module.milestone}</span> and
              is not active yet. NEXUS HASH AI never shows placeholder figures as if they were real data.
            </p>
          )}
        </Panel>
      )}
    </div>
  );
}
