import { useMemo } from "react";

import { formatMsTick } from "@/components/charts/scale";
import { TimeSeriesChart, type SeriesSpec } from "@/components/charts/TimeSeriesChart";
import { Panel } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { useHealth } from "@/hooks/useSystem";
import { useApiLatency } from "@/lib/apiLatency";
import { formatMs } from "@/lib/format";
import { useRealtime } from "@/lib/realtimeContext";
import { resampleSeries } from "@/lib/telemetry";

const SERIES: readonly SeriesSpec[] = [
  { key: "ws", label: "Realtime round-trip", color: "var(--color-series-1)" },
  { key: "api", label: "API health check", color: "var(--color-series-2)" },
];

const RESAMPLE = { bucketMs: 5_000, maxAgeMs: 12_000, windowMs: 10 * 60_000 };

/**
 * Latency between this browser and the backend, measured live: WebSocket
 * ping/pong every 5 s and the API health check every 10 s. Missing
 * measurements (an outage) render as gaps, never as interpolated values.
 */
export function TelemetryPanel() {
  const { rttSamples, status } = useRealtime();
  const apiSamples = useApiLatency();
  const health = useHealth();
  const data = useMemo(
    () => resampleSeries({ ws: rttSamples, api: apiSamples }, RESAMPLE),
    [rttSamples, apiSamples],
  );

  const live = status === "open" && !health.isError;
  return (
    <Panel
      title="Platform telemetry"
      eyebrow="Latency · last 10 minutes"
      actions={
        <div className="flex items-center gap-2">
          <ProvenanceBadge kind={live ? "live" : health.isError ? "offline" : "stale"} />
          <ProvenanceBadge kind="session" />
        </div>
      }
    >
      <TimeSeriesChart
        title="Platform latency"
        data={data}
        series={SERIES}
        formatValue={formatMs}
        formatTick={formatMsTick}
        emptyMessage="Collecting latency samples… the first appear within a few seconds."
      />
      <p className="mt-3 text-xs text-ink-faint">
        Measured by this browser: WebSocket ping/pong every 5 s and API health checks every 10 s, in 5-second
        buckets. Gaps mean no measurement was possible.
      </p>
    </Panel>
  );
}
