import { NavLink } from "react-router";

import { NexusWordmark } from "@/components/ui/NexusLogo";
import { StatusDot } from "@/components/ui/Status";
import { MODULE_STATUS_META } from "@/components/ui/status-meta";
import { NAV_ITEMS, NAV_SECTIONS } from "@/config/navigation";
import { useModules } from "@/hooks/useSystem";
import { cn } from "@/lib/format";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { data: modules } = useModules();
  const byKey = new Map(modules?.map((module) => [module.key, module]));

  return (
    <nav aria-label="Primary" className="flex h-full flex-col">
      <div className="px-5 pt-6 pb-8">
        <NexusWordmark />
      </div>

      <div className="flex-1 space-y-7 overflow-y-auto px-3">
        {NAV_SECTIONS.map((section) => (
          <div key={section.id}>
            <p className="px-3 pb-2 font-mono text-[10px] tracking-[0.22em] text-ink-faint uppercase">
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {NAV_ITEMS.filter((item) => item.section === section.id).map((item) => {
                const module = byKey.get(item.key);
                const meta = module ? MODULE_STATUS_META[module.status] : undefined;
                const Icon = item.icon;
                return (
                  <li key={item.key}>
                    <NavLink
                      to={item.path}
                      end={item.path === "/"}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cn(
                          "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                          isActive
                            ? "bg-ember-500/10 text-ink shadow-[inset_2px_0_0_var(--color-ember-500)]"
                            : "text-ink-muted hover:bg-panel-raised hover:text-ink",
                        )
                      }
                    >
                      <Icon className="size-4 shrink-0 opacity-80 group-hover:opacity-100" />
                      <span className="flex-1 truncate">{item.label}</span>
                      {module && meta && (
                        <span
                          className="flex items-center gap-1.5 font-mono text-[10px] text-ink-faint"
                          title={`${meta.label} · Milestone ${module.milestone}`}
                        >
                          {module.status !== "online" && `M${module.milestone}`}
                          <StatusDot tone={meta.tone} />
                        </span>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <p className="border-t border-edge/70 px-5 py-4 text-[11px] leading-relaxed text-ink-faint">
        Research &amp; simulation platform. Simulated hashes never reach the Bitcoin network.
      </p>
    </nav>
  );
}
