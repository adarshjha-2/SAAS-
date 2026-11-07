import { ChartLine, Table2 } from "lucide-react";
import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { formatClock } from "@/lib/format";
import type { SeriesRow } from "@/lib/telemetry";

import { niceTicks } from "./scale";

export interface SeriesSpec {
  key: string;
  label: string;
  /** A validated series token, e.g. `var(--color-series-1)`. */
  color: string;
}

interface TimeSeriesChartProps {
  data: readonly SeriesRow[];
  series: readonly SeriesSpec[];
  /** Accessible name and table caption. */
  title: string;
  formatValue: (value: number) => string;
  /** Formatter for clean y-axis ticks; defaults to `formatValue`. */
  formatTick?: (value: number) => string;
  /** Fixed upper bound for bounded quantities (e.g. 100 for percentages). */
  yMax?: number;
  height?: number;
  emptyMessage?: string;
}

type View = "chart" | "table";

const VIEW_OPTIONS = [
  { value: "chart", label: "Chart", icon: <ChartLine className="size-3.5" /> },
  { value: "table", label: "Table", icon: <Table2 className="size-3.5" /> },
] as const;

const TABLE_ROWS = 30;

function lastValue(data: readonly SeriesRow[], key: string): { t: number; value: number } | undefined {
  for (let index = data.length - 1; index >= 0; index -= 1) {
    const row = data[index];
    const value = row?.[key];
    if (row && typeof value === "number") return { t: row.t, value };
  }
  return undefined;
}

/** Short stroke in the series colour: identity next to text, never coloured text. */
function LineKey({ color }: { color: string }) {
  return (
    <span aria-hidden="true" className="inline-block h-0.5 w-3 rounded-full" style={{ background: color }} />
  );
}

function ChartTooltip({
  active,
  label,
  series,
  row,
  formatValue,
}: {
  active: boolean;
  label: string | number | undefined;
  series: readonly SeriesSpec[];
  row: SeriesRow | undefined;
  formatValue: (value: number) => string;
}) {
  if (!active || !row) return null;
  return (
    <div className="min-w-40 rounded-lg border border-edge-strong bg-abyss/95 px-3 py-2 shadow-xl backdrop-blur">
      <p className="font-mono text-[11px] text-ink-faint">
        {typeof label === "number" ? formatClock(label) : ""}
      </p>
      <ul className="mt-1.5 space-y-1">
        {series.map((spec) => {
          const value = row[spec.key];
          return (
            <li key={spec.key} className="flex items-center gap-2 text-xs">
              <LineKey color={spec.color} />
              <span className="font-mono font-semibold text-ink">
                {typeof value === "number" ? formatValue(value) : "no data"}
              </span>
              <span className="text-ink-muted">{spec.label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Time-series chart with the NEXUS data-viz conventions: one y-axis, 2px
 * lines with a 10% wash, solid hairline grid, a crosshair tooltip that lists
 * every series, a legend carrying each series' latest value, end markers, and
 * a table view twin so no value is reachable only by hovering.
 * Gaps (null) are drawn as gaps - missing data is never interpolated.
 */
export function TimeSeriesChart({
  data,
  series,
  title,
  formatValue,
  formatTick = formatValue,
  yMax,
  height = 220,
  emptyMessage = "Collecting samples…",
}: TimeSeriesChartProps) {
  const [view, setView] = useState<View>("chart");
  const hasData = data.filter((row) => series.some((spec) => typeof row[spec.key] === "number")).length >= 2;
  let peak = 0;
  for (const row of data) {
    for (const spec of series) {
      const value = row[spec.key];
      if (typeof value === "number" && value > peak) peak = value;
    }
  }
  const yTicks = niceTicks(yMax ?? peak);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <ul aria-label={`${title} legend`} className="flex flex-wrap items-center gap-x-5 gap-y-1">
          {series.map((spec) => {
            const latest = lastValue(data, spec.key);
            return (
              <li key={spec.key} className="flex items-center gap-2 text-xs">
                <LineKey color={spec.color} />
                <span className="text-ink-muted">{spec.label}</span>
                <span className="font-mono font-semibold text-ink">
                  {latest ? formatValue(latest.value) : "—"}
                </span>
              </li>
            );
          })}
        </ul>
        <SegmentedControl label={`${title} view`} options={VIEW_OPTIONS} value={view} onChange={setView} />
      </div>

      {view === "table" ? (
        <div className="max-h-[260px] overflow-y-auto rounded-lg border border-edge">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{title} (newest first)</caption>
            <thead className="sticky top-0 bg-panel-raised text-ink-faint">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Time
                </th>
                {series.map((spec) => (
                  <th key={spec.key} scope="col" className="px-3 py-2 text-right font-medium">
                    {spec.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-edge/70 font-mono font-tabular">
              {data.length === 0 && (
                <tr>
                  <td colSpan={series.length + 1} className="px-3 py-4 text-center text-ink-faint">
                    {emptyMessage}
                  </td>
                </tr>
              )}
              {data
                .slice(-TABLE_ROWS)
                .reverse()
                .map((row) => (
                  <tr key={row.t}>
                    <td className="px-3 py-1.5 text-ink-muted">{formatClock(row.t)}</td>
                    {series.map((spec) => {
                      const value = row[spec.key];
                      return (
                        <td key={spec.key} className="px-3 py-1.5 text-right text-ink">
                          {typeof value === "number" ? formatValue(value) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : hasData ? (
        <figure aria-label={title} style={{ height }}>
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height }}>
            <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--color-edge)" strokeWidth={1} vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickFormatter={formatClock}
                minTickGap={48}
                tickMargin={10}
                tickLine={false}
                axisLine={{ stroke: "var(--color-edge-strong)" }}
                tick={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
              />
              <YAxis
                domain={[0, yTicks[yTicks.length - 1] ?? 1]}
                ticks={yTicks}
                interval={0}
                tickFormatter={formatTick}
                width={56}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
              />
              <Tooltip
                cursor={{ stroke: "var(--color-ink-faint)", strokeWidth: 1 }}
                isAnimationActive={false}
                content={(props: TooltipContentProps) => (
                  <ChartTooltip
                    active={props.active}
                    label={props.label}
                    series={series}
                    row={data.find((row) => row.t === props.label)}
                    formatValue={formatValue}
                  />
                )}
              />
              {series.map((spec) => (
                <Area
                  key={spec.key}
                  dataKey={spec.key}
                  name={spec.label}
                  type="monotone"
                  stroke={spec.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill={spec.color}
                  fillOpacity={0.1}
                  dot={false}
                  activeDot={{ r: 4, fill: spec.color, stroke: "var(--color-panel)", strokeWidth: 2 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
              {series.map((spec) => {
                const end = lastValue(data, spec.key);
                return end ? (
                  <ReferenceDot
                    key={`${spec.key}-end`}
                    x={end.t}
                    y={end.value}
                    r={4}
                    fill={spec.color}
                    stroke="var(--color-panel)"
                    strokeWidth={2}
                  />
                ) : null;
              })}
            </AreaChart>
          </ResponsiveContainer>
        </figure>
      ) : (
        <div
          style={{ height }}
          className="flex items-center justify-center rounded-lg border border-dashed border-edge-strong/70 text-sm text-ink-faint"
        >
          {emptyMessage}
        </div>
      )}
    </div>
  );
}
