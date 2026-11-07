import { Link } from "react-router";

import { Panel } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { Sparkline } from "@/components/ui/Sparkline";
import { useHardwareSpecs, useHardwareStream } from "@/hooks/useHardware";
import { formatBytes } from "@/lib/format";

/** Dashboard panel: live CPU and memory, plus what this machine cannot report. */
export function HardwareSlot() {
  const { samples } = useHardwareStream();
  const specs = useHardwareSpecs();
  const latest = samples.at(-1);
  const unavailable = specs.data?.capabilities.filter((cap) => !cap.supported).map((cap) => cap.label) ?? [];

  return (
    <Panel title="Hardware status" eyebrow="Hardware Intelligence" actions={<ProvenanceBadge kind="live" />}>
      {latest ? (
        <div className="space-y-3 text-sm">
          <dl className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-xs text-ink-faint">CPU</dt>
              <dd className="flex items-center justify-between gap-2 font-mono text-ink">
                {latest.cpu_percent.toFixed(1)}%
                <Sparkline
                  values={samples.map((sample) => sample.cpu_percent)}
                  color="var(--color-series-1)"
                  label="CPU trend"
                />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-faint">Memory</dt>
              <dd className="font-mono text-ink">
                {latest.memory.percent.toFixed(1)}%
                <span className="ml-1 text-xs text-ink-faint">
                  of {formatBytes(latest.memory.total_bytes)}
                </span>
              </dd>
            </div>
          </dl>
          {unavailable.length > 0 && (
            <p className="text-xs text-ink-faint">Not available on this machine: {unavailable.join(", ")}.</p>
          )}
          <Link to="/hardware" className="inline-block text-sm text-flux-400 hover:text-flux-300">
            Open Hardware Intelligence →
          </Link>
        </div>
      ) : (
        <p className="text-sm text-ink-muted">Waiting for the first sample…</p>
      )}
    </Panel>
  );
}
