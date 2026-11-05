import { BrainCircuit, Cpu, FlaskConical, Globe, type LucideIcon } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { Panel } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { useModules } from "@/hooks/useSystem";
import type { ModuleKey } from "@/types/api";

import { MiningSimulationSlot } from "./MiningSimulationSlot";

interface Slot {
  key: ModuleKey;
  title: string;
  icon: LucideIcon;
  preview: string;
}

/** Dashboard panels reserved for module data. Each shows what will appear, never stand-in numbers. */
const SLOTS: readonly Slot[] = [
  {
    key: "hardware",
    title: "Hardware status",
    icon: Cpu,
    preview:
      "CPU, GPU, memory, temperature and power telemetry, read-only and limited to what this machine exposes.",
  },
  {
    key: "hashlab",
    title: "Mining simulation",
    icon: FlaskConical,
    preview:
      "Proof-of-work runs from HashLab: hash rate, attempts and blocks found, always labelled as simulation.",
  },
  {
    key: "network",
    title: "Bitcoin network",
    icon: Globe,
    preview:
      "Price, difficulty, block height, network hash rate and mempool, each with its source and freshness.",
  },
  {
    key: "intelligence",
    title: "AI recommendations",
    icon: BrainCircuit,
    preview:
      "Efficiency findings and anomaly alerts from Nexus Intelligence, each citing the data behind it.",
  },
];

export function ModuleSlots() {
  const { data: modules } = useModules();
  return (
    <section aria-labelledby="module-intelligence-heading">
      <h2
        id="module-intelligence-heading"
        className="mb-3 font-mono text-[11px] tracking-[0.22em] text-ink-faint uppercase"
      >
        Module intelligence
      </h2>
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {SLOTS.map((slot) => {
          const module = modules?.find((entry) => entry.key === slot.key);
          const Icon = slot.icon;
          if (slot.key === "hashlab" && module?.status === "online") {
            return <MiningSimulationSlot key={slot.key} />;
          }
          return (
            <Panel
              key={slot.key}
              title={slot.title}
              eyebrow={module?.name ?? "Module"}
              actions={
                module && module.status !== "online" ? (
                  <ProvenanceBadge kind="planned" suffix={`M${module.milestone}`} />
                ) : undefined
              }
              className="flex flex-col"
            >
              <EmptyState
                icon={<Icon className="size-4" />}
                title={module ? `Arrives in Milestone ${module.milestone}` : "Loading module status…"}
              >
                {slot.preview}
              </EmptyState>
            </Panel>
          );
        })}
      </div>
    </section>
  );
}
