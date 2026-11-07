import { CircleCheck, CircleSlash, Cpu, Gauge, MemoryStick, Thermometer, Zap } from "lucide-react";
import { useState } from "react";

import { TimeSeriesChart, type SeriesSpec } from "@/components/charts/TimeSeriesChart";
import { Panel } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { StatTile } from "@/components/ui/StatTile";
import { useHardwareHistory, useHardwareSpecs, useHardwareStream } from "@/hooks/useHardware";
import { formatBytes } from "@/lib/format";
import { withGaps, type SeriesRow } from "@/lib/telemetry";
import type { Capability, CapabilityKey, HardwareSample, HardwareSpecs } from "@/types/hardware";

const percent = (value: number) => `${value.toFixed(1)}%`;
const percentTick = (value: number) => `${value}%`;

const LIVE_SERIES: readonly SeriesSpec[] = [
  { key: "cpu", label: "CPU", color: "var(--color-series-1)" },
  { key: "memory", label: "Memory", color: "var(--color-series-2)" },
];
const HISTORY_SERIES: readonly SeriesSpec[] = [
  { key: "cpu", label: "CPU (average)", color: "var(--color-series-1)" },
  { key: "memory", label: "Memory (average)", color: "var(--color-series-2)" },
];
const WINDOWS = [
  { value: "1", label: "1 h" },
  { value: "6", label: "6 h" },
  { value: "24", label: "24 h" },
  { value: "168", label: "7 d" },
] as const;

function capability(specs: HardwareSpecs | undefined, key: CapabilityKey): Capability | undefined {
  return specs?.capabilities.find((entry) => entry.key === key);
}

/** A tile for a metric this machine may not expose: the reason replaces a fake zero. */
function OptionalTile({
  icon,
  label,
  cap,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  cap: Capability | undefined;
  value: string | null;
  detail?: string | undefined;
}) {
  if (cap && !cap.supported) {
    return <StatTile icon={icon} label={label} value="Not available" detail={cap.reason ?? undefined} />;
  }
  return <StatTile icon={icon} label={label} value={value ?? "…"} detail={detail} tone="flux" />;
}

function LiveTiles({
  latest,
  specs,
  samples,
}: {
  latest: HardwareSample | undefined;
  specs?: HardwareSpecs | undefined;
  samples: HardwareSample[];
}) {
  const cores = specs?.cpu_logical_cores ?? latest?.cpu_per_core.length ?? 0;
  const maxTemp = latest?.temperatures?.length
    ? Math.max(...latest.temperatures.map((t) => t.celsius))
    : null;
  const gpu = latest?.gpus?.[0];
  const gpuPower = latest?.gpus?.reduce((sum, g) => sum + (g.power_w ?? 0), 0) ?? 0;
  const power = latest?.power_w ?? (gpuPower > 0 ? gpuPower : null);
  return (
    <section aria-label="Live hardware" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      <StatTile
        icon={<Cpu className="size-3.5" />}
        label="CPU"
        value={latest ? percent(latest.cpu_percent) : "…"}
        detail={
          latest?.cpu_frequency_mhz
            ? `${cores} cores · ${latest.cpu_frequency_mhz.toFixed(0)} MHz`
            : `${cores} cores`
        }
        tone="flux"
        trend={samples.map((sample) => sample.cpu_percent)}
        trendLabel="CPU utilisation trend"
      />
      <StatTile
        icon={<MemoryStick className="size-3.5" />}
        label="Memory"
        value={latest ? percent(latest.memory.percent) : "…"}
        detail={
          latest
            ? `${formatBytes(latest.memory.used_bytes)} of ${formatBytes(latest.memory.total_bytes)}`
            : undefined
        }
        tone="flux"
        trend={samples.map((sample) => sample.memory.percent)}
        trendColor="var(--color-series-2)"
        trendLabel="Memory use trend"
      />
      <OptionalTile
        icon={<Gauge className="size-3.5" />}
        label="Load average"
        cap={capability(specs, "load_average")}
        value={latest?.load_average ? latest.load_average[0].toFixed(2) : null}
        detail={
          latest?.load_average
            ? `1 min · 5 min ${latest.load_average[1].toFixed(2)} · 15 min ${latest.load_average[2].toFixed(2)} · ${cores} cores`
            : `${cores} cores`
        }
      />
      <OptionalTile
        icon={<Thermometer className="size-3.5" />}
        label="Temperature"
        cap={capability(specs, "temperature")}
        value={maxTemp !== null ? `${maxTemp.toFixed(1)} °C` : null}
        detail="Hottest CPU sensor"
      />
      <OptionalTile
        icon={<Cpu className="size-3.5" />}
        label="GPU"
        cap={capability(specs, "gpu")}
        value={
          gpu?.utilization_percent !== null && gpu?.utilization_percent !== undefined
            ? percent(gpu.utilization_percent)
            : null
        }
        detail={specs?.gpus[0]?.name}
      />
      <OptionalTile
        icon={<Zap className="size-3.5" />}
        label="Power draw"
        cap={capability(specs, "power")}
        value={power !== null ? `${power.toFixed(1)} W` : null}
        detail={capability(specs, "power")?.source ?? undefined}
      />
    </section>
  );
}

function CoreMeters({ latest }: { latest: HardwareSample | undefined }) {
  if (!latest) return null;
  return (
    <ul aria-label="Per-core utilisation" className="space-y-2">
      {latest.cpu_per_core.map((value, index) => (
        <li key={index} className="flex items-center gap-3 text-xs">
          <span className="w-14 shrink-0 font-mono text-ink-faint">Core {index}</span>
          <div
            role="meter"
            aria-label={`Core ${index} utilisation`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(value)}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-flux-900"
          >
            <div className="h-full rounded-full bg-series-1" style={{ width: `${Math.min(100, value)}%` }} />
          </div>
          <span className="w-12 shrink-0 text-right font-mono text-ink">{percent(value)}</span>
        </li>
      ))}
    </ul>
  );
}

function CapabilityMatrix({ specs }: { specs: HardwareSpecs }) {
  return (
    <table className="w-full text-left text-sm">
      <caption className="mb-2 text-left text-xs text-ink-muted">
        What this machine lets NEXUS HASH AI measure. Unavailable metrics are never shown as zero.
      </caption>
      <tbody className="divide-y divide-edge/60">
        {specs.capabilities.map((cap) => (
          <tr key={cap.key}>
            <th scope="row" className="py-2 pr-3 font-normal text-ink">
              {cap.label}
            </th>
            <td className="py-2 pr-3">
              {cap.supported ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-ok">
                  <CircleCheck className="size-3.5" aria-hidden="true" /> Available
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs text-ink-faint">
                  <CircleSlash className="size-3.5" aria-hidden="true" /> Not available
                </span>
              )}
            </td>
            <td className="py-2 text-xs text-ink-muted">
              {cap.supported ? `via ${cap.source}` : cap.reason}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SpecsList({ specs }: { specs: HardwareSpecs }) {
  const rows: [string, string][] = [
    ["CPU", specs.cpu_model ?? "Unknown"],
    ["Cores", `${specs.cpu_logical_cores ?? "?"} logical · ${specs.cpu_physical_cores ?? "?"} physical`],
    ["Memory", formatBytes(specs.memory_total_bytes)],
    ...(specs.memory_limit_bytes
      ? ([["Container memory limit", formatBytes(specs.memory_limit_bytes)]] as [string, string][])
      : []),
    ["Swap", specs.swap_total_bytes > 0 ? formatBytes(specs.swap_total_bytes) : "None configured"],
    ["GPUs", specs.gpus.length ? specs.gpus.map((gpu) => gpu.name).join(", ") : "None detected"],
    ["System", `${specs.os} · ${specs.architecture}`],
    ["Virtual machine", specs.virtualized === null ? "Unknown" : specs.virtualized ? "Yes" : "No"],
    ["Booted", new Date(specs.boot_time).toLocaleString()],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-ink-muted">{term}</dt>
          <dd className="text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function HistoryPanel() {
  const [hours, setHours] = useState<(typeof WINDOWS)[number]["value"]>("24");
  const history = useHardwareHistory(Number(hours));
  const points = history.data?.points ?? [];
  const spacing = (points[0]?.window_seconds ?? 60) * 1000;
  const rows: SeriesRow[] = withGaps(
    points.map((point) => ({
      t: Date.parse(point.ts),
      cpu: point.cpu_avg,
      memory: point.memory_percent_avg,
    })),
    spacing * 2.5,
    ["cpu", "memory"],
  );
  return (
    <Panel title="History" eyebrow="One point per minute" actions={<ProvenanceBadge kind="live" />}>
      <div className="mb-4 flex items-center gap-3">
        <span className="text-xs text-ink-muted">Window</span>
        <SegmentedControl label="History window" options={WINDOWS} value={hours} onChange={setHours} />
      </div>
      {history.isError ? (
        <p className="text-sm text-fault">Could not load history: {history.error.message}</p>
      ) : (
        <TimeSeriesChart
          title="Hardware history"
          data={rows}
          series={HISTORY_SERIES}
          formatValue={percent}
          formatTick={percentTick}
          yMax={100}
          emptyMessage="History builds up while the server runs: one aggregated point per minute."
        />
      )}
      <p className="mt-3 text-xs text-ink-faint">
        Gaps mean the server was not running, so nothing was measured.
      </p>
    </Panel>
  );
}

export function HardwarePage() {
  const specs = useHardwareSpecs();
  const stream = useHardwareStream();
  const latest = stream.samples.at(-1);
  const liveRows: SeriesRow[] = stream.samples.map((sample) => ({
    t: Date.parse(sample.ts),
    cpu: sample.cpu_percent,
    memory: sample.memory.percent,
  }));

  return (
    <div className="space-y-6">
      <section className="flex animate-fade-up flex-wrap items-start gap-4">
        <div className="rounded-xl border border-flux-500/30 bg-flux-500/10 p-3 shadow-glow-flux">
          <Cpu className="size-6 text-flux-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] tracking-[0.3em] text-ember-400 uppercase">
            Intelligence module
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">Hardware Intelligence</h1>
          <p className="mt-1 max-w-2xl text-ink-muted">
            Read-only monitoring of this machine. Monitoring never generates load, and anything the machine
            does not expose is shown as unavailable, with the reason.
          </p>
        </div>
        <ProvenanceBadge kind="live" />
      </section>

      {(specs.isError || stream.isError) && (
        <p role="alert" className="rounded-lg border border-fault/40 px-4 py-3 text-sm text-fault">
          {specs.error?.message ?? "Could not load hardware data."}
        </p>
      )}

      <LiveTiles latest={latest} specs={specs.data} samples={stream.samples} />

      <div className="grid gap-6 xl:grid-cols-12">
        <div className="xl:col-span-8">
          <Panel title="Live utilisation" eyebrow="Last 10 minutes" actions={<ProvenanceBadge kind="live" />}>
            <TimeSeriesChart
              title="Live utilisation"
              data={liveRows}
              series={LIVE_SERIES}
              formatValue={percent}
              formatTick={percentTick}
              yMax={100}
              emptyMessage="Collecting samples…"
            />
          </Panel>
        </div>
        <Panel title="Per core" eyebrow="Right now" className="xl:col-span-4">
          <CoreMeters latest={latest} />
          {latest && (
            <p className="mt-4 text-xs text-ink-faint">
              Monitoring overhead: the NEXUS HASH AI server process is using{" "}
              {percent(latest.process.cpu_percent)} CPU and {formatBytes(latest.process.rss_bytes)} of memory.
            </p>
          )}
        </Panel>
      </div>

      <HistoryPanel />

      {specs.data && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="What can be measured" eyebrow="Capabilities">
            <CapabilityMatrix specs={specs.data} />
          </Panel>
          <Panel title="Machine" eyebrow="Specification">
            <SpecsList specs={specs.data} />
          </Panel>
        </div>
      )}
    </div>
  );
}
