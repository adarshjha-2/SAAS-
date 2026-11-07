import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { formatMs } from "@/lib/format";
import type { SeriesRow } from "@/lib/telemetry";

import { Sparkline } from "../ui/Sparkline";
import { TimeSeriesChart, type SeriesSpec } from "./TimeSeriesChart";

const SERIES: SeriesSpec[] = [
  { key: "ws", label: "Realtime", color: "var(--color-series-1)" },
  { key: "api", label: "API", color: "var(--color-series-2)" },
];

const DATA: SeriesRow[] = [
  { t: 5_000, ws: 10, api: 40 },
  { t: 10_000, ws: null, api: 42 },
  { t: 15_000, ws: 12, api: null },
];

const renderChart = (data: SeriesRow[] = DATA) =>
  render(<TimeSeriesChart title="Latency" data={data} series={SERIES} formatValue={formatMs} />);

describe("TimeSeriesChart", () => {
  it("shows an explicit empty state until there are enough points", () => {
    renderChart([{ t: 5_000, ws: 10, api: null }]);
    expect(screen.getByText("Collecting samples…")).toBeInTheDocument();
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
  });

  it("renders the chart with a legend carrying each series' latest value", () => {
    renderChart();
    expect(screen.getByRole("figure", { name: "Latency" })).toBeInTheDocument();
    const legend = within(screen.getByRole("list", { name: "Latency legend" }));
    // Latest non-null value per series, not the last row's (which has a gap).
    expect(legend.getByText("12 ms")).toBeInTheDocument();
    expect(legend.getByText("42 ms")).toBeInTheDocument();
  });

  it("has a table view twin, newest first, with gaps shown as dashes", async () => {
    renderChart();
    await userEvent.click(screen.getByRole("button", { name: "Table" }));
    expect(screen.getByRole("button", { name: "Table" })).toHaveAttribute("aria-pressed", "true");

    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows).toHaveLength(4); // header + 3
    expect(
      within(rows[1]!)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual([expect.any(String), "12 ms", "—"]);
    expect(within(rows[2]!).getAllByRole("cell")[1]).toHaveTextContent("—");

    await userEvent.click(screen.getByRole("button", { name: "Chart" }));
    expect(screen.getByRole("figure", { name: "Latency" })).toBeInTheDocument();
  });
});

describe("Sparkline", () => {
  it("renders nothing for fewer than two points", () => {
    const { container } = render(<Sparkline values={[1]} color="red" label="trend" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders an accessible trend of at most 12 points", () => {
    render(<Sparkline values={Array.from({ length: 30 }, (_, i) => i)} color="red" label="RTT trend" />);
    const svg = screen.getByRole("img", { name: "RTT trend" });
    const points = svg.querySelector("polyline")?.getAttribute("points")?.split(" ");
    expect(points).toHaveLength(12);
  });
});
